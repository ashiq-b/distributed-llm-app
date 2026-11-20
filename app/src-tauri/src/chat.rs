//! The chat session with the loaded model. History lives here (not in the UI), so it
//! always matches the model it was written with.

use dl_engine::{ChatMessage, ChatRole};

#[derive(Debug, Default)]
pub struct ChatSession {
    model_id: Option<String>,
    history: Vec<ChatMessage>,
    busy: bool,
}

impl ChatSession {
    /// A model was loaded: a different model starts a new conversation.
    pub fn model_loaded(&mut self, model_id: &str) {
        if self.model_id.as_deref() != Some(model_id) {
            self.history.clear();
            self.model_id = Some(model_id.to_string());
        }
    }

    /// Start over with the same model. Refused while an answer is being written.
    pub fn reset(&mut self) -> Result<(), String> {
        if self.busy {
            return Err("still answering; stop it first".into());
        }
        self.history.clear();
        Ok(())
    }

    pub fn history(&self) -> &[ChatMessage] {
        &self.history
    }

    /// Add the user's message and return the full conversation to send.
    /// Refused while an answer is still being written.
    pub fn begin_turn(&mut self, text: &str) -> Result<Vec<ChatMessage>, String> {
        if self.busy {
            return Err("still answering".into());
        }
        let text = text.trim();
        if text.is_empty() {
            return Err("empty message".into());
        }
        self.busy = true;
        self.history.push(ChatMessage { role: ChatRole::User, content: text.to_string() });
        Ok(self.history.clone())
    }

    /// The answer is complete (or was stopped): keep it, minus the model's reasoning.
    /// No answer at all (e.g. the length ran out while thinking) is treated like a failure.
    pub fn end_turn(&mut self, answer: &str) {
        let answer = without_thinking(answer);
        if answer.is_empty() {
            return self.fail_turn();
        }
        self.busy = false;
        self.history.push(ChatMessage { role: ChatRole::Assistant, content: answer });
    }

    /// Generation failed: forget the unanswered message so it can be sent again.
    pub fn fail_turn(&mut self) {
        self.busy = false;
        if self.history.last().is_some_and(|m| m.role == ChatRole::User) {
            self.history.pop();
        }
    }
}

/// Reasoning ("<think>…</think>") is shown while streaming but not sent back as history:
/// it wastes context. An unclosed block (answer stopped mid-thought) is dropped too.
pub fn without_thinking(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("<think>") {
        out.push_str(&rest[..start]);
        match rest[start..].find("</think>") {
            Some(end) => rest = &rest[start + end + "</think>".len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_history_resets_on_new_model() {
        let mut c = ChatSession::default();
        c.model_loaded("lfm3-1.7b");
        c.begin_turn("Hi").unwrap();
        c.end_turn("Hello!");
        assert_eq!(c.history().len(), 2);

        c.model_loaded("lfm3-1.7b");
        assert_eq!(c.history().len(), 2, "reloading the same model keeps the conversation");
        c.model_loaded("qwen3.5-2b");
        assert!(c.history().is_empty(), "a different model starts over");

        c.begin_turn("Hi").unwrap();
        assert!(c.reset().is_err(), "not while answering");
        c.end_turn("Hey");
        c.reset().unwrap();
        assert!(c.history().is_empty());
    }

    #[test]
    fn turns_build_the_conversation() {
        let mut c = ChatSession::default();
        c.model_loaded("m");
        let sent = c.begin_turn("What is 2+2?").unwrap();
        assert_eq!(sent, vec![ChatMessage { role: ChatRole::User, content: "What is 2+2?".into() }]);
        assert_eq!(c.begin_turn("again"), Err("still answering".into()));
        c.end_turn("<think>\nadd them\n</think>\n\n4");
        let sent = c.begin_turn("And 3+3?").unwrap();
        assert_eq!(sent.len(), 3);
        assert_eq!(sent[1], ChatMessage { role: ChatRole::Assistant, content: "4".into() });
        c.fail_turn();
        assert_eq!(c.history().len(), 2, "the failed message is dropped");
        assert!(c.begin_turn("And 3+3?").is_ok(), "and can be sent again");
        assert_eq!(c.begin_turn("  "), Err("still answering".into()));
    }

    #[test]
    fn empty_message_is_refused() {
        let mut c = ChatSession::default();
        assert_eq!(c.begin_turn("   "), Err("empty message".into()));
    }

    #[test]
    fn thinking_is_stripped() {
        assert_eq!(without_thinking("<think>a</think>\n\nParis"), "Paris");
        assert_eq!(without_thinking("x <think>a</think> y <think>b</think>z"), "x  y z");
        assert_eq!(without_thinking("Answer <think>stopped mid-thou"), "Answer");
        assert_eq!(without_thinking("plain"), "plain");
    }

    #[test]
    fn history_never_stores_an_empty_reply() {
        let mut c = ChatSession::default();
        c.model_loaded("m");
        c.begin_turn("Who won?").unwrap();
        // Ran out of length while still thinking: nothing to keep, and the question can be asked again.
        c.end_turn("<think>Let me recall the 2021 season");
        assert!(c.history().is_empty());
        assert!(c.begin_turn("Who won?").is_ok());
        c.end_turn("   ");
        assert!(c.history().is_empty());
    }
}
