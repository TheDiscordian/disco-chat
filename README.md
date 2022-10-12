This repo is a WIP. DiscoChat works fine but isn't ready for production.

## Requirements

- [Rust](https://www.rust-lang.org/)

## Setup

### Install Tauri

```sh
cargo install tauri-cli
```

### Fetch Kubo

#### Linux / Mac

This hasn't been tested much, but definitely works on Apple Silicon. Might not work on Linux, but shouldn't need too much tweaking...

```sh
./fetch-kubo.sh
```

If it doesn't work for you refer to the Windows instructions for how to obtain and rename the kubo binary.

#### Windows

Grab the appropriate [kubo binary](https://dist.ipfs.tech/#kubo). Ensure you extract the package, pulling the ipfs binary out. Then move it to `bin/` naming it according to [this guide](https://tauri.app/v1/guides/building/sidecar/)'s parameters (final name will be something like `kubo-x86_64-pc-windows-msvc.exe`, probably, check [here](https://doc.rust-lang.org/nightly/rustc/platform-support.html#tier-1-with-host-tools) if you can't figure out your triple).

## Run as Dev

```sh
cargo tauri dev
```
