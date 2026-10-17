mod addon_host;
mod assets;
mod config;
mod codex_runner;
mod diff_popup;
mod layout;
mod protocol;
mod server;
mod service_control;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let first = std::env::args().nth(1);
    let second = std::env::args().nth(2);
    match first.as_deref() {
        None | Some("bridge") => server::run().await,
        Some("addon-host") | Some("host") => addon_host::run().await,
        Some("services") => service_control::run_cli(second.as_deref().unwrap_or("start")).await,
        Some(other) => anyhow::bail!("Unknown mode: {other}"),
    }
}
