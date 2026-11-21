//! Host a model split across workers from the command line, and ask it one question.
//! Prints what each device holds (from llama.cpp's load report) and the answer.
//!
//!   cargo run --release --example host -- <model.gguf> <host:port>... -- "<prompt>"
//!
//! Handy for checking a worker (a phone in Worker mode) without the app's UI.
use std::io::Write;
use std::ops::ControlFlow;
use std::time::Instant;

use dl_engine::{ChatMessage, ChatRole, GenParams, Host};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let split = args.iter().position(|a| a == "--").unwrap_or(args.len());
    let (Some(model), Some(prompt)) = (args.first(), args.get(split + 1)) else {
        eprintln!("usage: host <model.gguf> <host:port>... -- \"<prompt>\"");
        std::process::exit(2);
    };
    let workers = &args[1..split];

    let started = Instant::now();
    let host = Host::load(model.as_ref(), workers, None, |_| {}).unwrap_or_else(|e| {
        eprintln!("load failed: {e}");
        std::process::exit(1);
    });
    println!("loaded in {} ms", started.elapsed().as_millis());
    for s in host.device_shares() {
        let mib = s.buffer_mib.map_or("unknown".into(), |m| format!("{m:.2} MiB"));
        let layers = s.layers.map_or("unknown".into(), |(a, b)| format!("{a}-{b}"));
        println!("  {:<28} {mib:>12}  layers {layers}", s.name);
    }

    let question = [ChatMessage { role: ChatRole::User, content: prompt.clone() }];
    let params = GenParams { max_tokens: 256, temperature: 0.0, seed: 1, think: false };
    println!("\n> {prompt}");
    let summary = host
        .generate(&question, params, |piece| {
            print!("{piece}");
            let _ = std::io::stdout().flush();
            ControlFlow::Continue(())
        })
        .unwrap_or_else(|e| {
            eprintln!("\ngeneration failed: {e}");
            std::process::exit(1);
        });
    let tps = summary.tokens as f64 / (summary.millis.max(1) as f64 / 1000.0);
    println!("\n\n{} tokens in {} ms ({tps:.1} tokens/s), stopped: {:?}", summary.tokens, summary.millis, summary.stopped);
}
