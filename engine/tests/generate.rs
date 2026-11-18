mod common;

use std::ops::ControlFlow;
use std::time::{Duration, Instant};

use common::{serial, test_model, RpcServer};
use dl_engine::{ChatMessage, ChatRole, EngineError, GenParams, Host, StopReason};

fn question() -> Vec<ChatMessage> {
    vec![ChatMessage { role: ChatRole::User, content: "What is the capital of France? Answer in one word.".into() }]
}

fn greedy(max_tokens: u32) -> GenParams {
    GenParams { max_tokens, temperature: 0.0, seed: 1 }
}

#[test]
fn split_greedy_matches_single_device() {
    let _g = serial();
    let Some(model) = test_model() else { return };

    let mut single = String::new();
    {
        let host = Host::load(&model, &[], None, |_| {}).unwrap();
        let summary = host.generate(&question(), greedy(16), |p| { single.push_str(p); ControlFlow::Continue(()) }).unwrap();
        assert!(summary.tokens > 0);
    }

    let server = RpcServer::spawn();
    let mut split = String::new();
    let host = Host::load(&model, &[server.endpoint()], None, |_| {}).unwrap();
    let shares = host.device_shares();
    eprintln!("shares: {shares:?}");
    assert!(shares.iter().any(|s| s.is_remote && s.buffer_mib.unwrap_or(0.0) > 0.0));
    host.generate(&question(), greedy(16), |p| { split.push_str(p); ControlFlow::Continue(()) }).unwrap();

    eprintln!("single: {single:?}\nsplit:  {split:?}");
    assert!(!single.trim().is_empty());
    assert_eq!(single, split);
}

#[test]
fn cancel_stops_generation() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let host = Host::load(&model, &[], None, |_| {}).unwrap();

    let mut pieces = 0;
    let summary = host
        .generate(&question(), greedy(200), |_| {
            pieces += 1;
            if pieces == 3 {
                host.cancel();
            }
            ControlFlow::Continue(())
        })
        .unwrap();
    assert_eq!(summary.stopped, StopReason::Cancelled);
    assert!(summary.tokens <= 4, "generated {} tokens after cancel", summary.tokens);

    // Returning Break from the callback stops it too.
    let summary = host.generate(&question(), greedy(200), |_| ControlFlow::Break(())).unwrap();
    assert_eq!(summary.stopped, StopReason::Cancelled);
}

#[test]
fn max_tokens_is_reported() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let host = Host::load(&model, &[], None, |_| {}).unwrap();
    let long = vec![ChatMessage { role: ChatRole::User, content: "Count from 1 to 100, separated by commas.".into() }];
    let summary = host.generate(&long, greedy(5), |_| ControlFlow::Continue(())).unwrap();
    assert_eq!(summary.stopped, StopReason::MaxTokens);
    assert_eq!(summary.tokens, 5);
}

#[test]
fn worker_loss_returns_error() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let mut server = RpcServer::spawn();
    let endpoint = server.endpoint();
    let host = Host::load(&model, &[endpoint.clone()], None, |_| {}).unwrap();

    let long = vec![ChatMessage { role: ChatRole::User, content: "Write a long story about a lighthouse keeper.".into() }];
    let mut killed_at: Option<Instant> = None;
    let result = host.generate(&long, greedy(500), |_| {
        if killed_at.is_none() {
            server.child.kill().unwrap();
            server.child.wait().unwrap();
            killed_at = Some(Instant::now());
        }
        ControlFlow::Continue(())
    });

    // We are still alive (no abort), and the loss is reported as an error, quickly.
    match result {
        Err(EngineError::WorkerLost(ep)) => assert_eq!(ep, endpoint),
        other => panic!("expected Err(WorkerLost), got {other:?}"),
    }
    assert!(killed_at.unwrap().elapsed() < Duration::from_secs(10));

    // The broken model can be unloaded, and a new worker on the same port can be used again.
    drop(host);
    let fresh = RpcServer::spawn();
    let host = Host::load(&model, &[fresh.endpoint()], None, |_| {}).unwrap();
    let summary = host.generate(&question(), greedy(4), |_| ControlFlow::Continue(())).unwrap();
    assert!(summary.tokens > 0);
}
