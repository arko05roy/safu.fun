//! NEP-297 style event logs (`EVENT_JSON:{...}`), consumed by the watcher,
//! relayer and frontend indexers.
use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub fn emit(event: &str, data: Value) {
    let ev = json!({
        "standard": "safu",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}
