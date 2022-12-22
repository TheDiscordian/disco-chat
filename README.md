Welcome to Disco Chat! A peer-to-peer chat application built using Tauri, JavaScript, and HTML.

Disco Chat is meant to be a fun, easy-to-use chat application, but it's also meant to help show developers how to build applications like it. It's based upon [native-ipfs-building-blox](https://github.com/TheDiscordian/native-ipfs-building-blox), which is a great kit for getting started on building desktop IPFS applications using HTML/Javascript (Rust too if you like!).

A couple code snippets of note:

- [Easy-to-use encryption](ui/crypto.js)
- [IPNS-based user profiles](ui/peers/ipns.js)

If you run into any problems please reach out to [our community](https://docs.ipfs.tech/community/chat/), or [open an issue](https://github.com/TheDiscordian/disco-chat/issues/new/choose).

## Getting the binaries

We don't currently have any binaries, but are working on getting them out. Below are instructions on how to build the application from source.

## Requirements

- [Rust](https://www.rust-lang.org/)
- [Python3](https://python.org)
- [Protoc](https://grpc.io/docs/protoc-installation/)
- [npm](https://nodejs.org/en/download/)

## Setup

### Download the Source

```sh
git clone https://github.com/TheDiscordian/disco-chat.git
cd disco-chat
```

### Install Tauri

```sh
cargo install tauri-cli
```

### Install libraries

```sh
npm install
npm run build
```

### Fetch Kubo

#### Linux / Mac

```sh
./fetch-kubo.sh
```

If it doesn't work for you refer to the Windows instructions for how to obtain and rename the kubo binary.

#### Windows

Warning: There be 🐉. While users have gotten Disco Chat running in WSL, no one has run it natively on Windows yet without WSL. If you get it working, a PR to this README would be *hugely* appreciated.

Grab the appropriate [kubo binary](https://dist.ipfs.tech/#kubo). Ensure you extract the package, pulling the ipfs binary out. Then move it to `bin/` naming it according to [this guide](https://tauri.app/v1/guides/building/sidecar/)'s parameters (final name will be something like `kubo-x86_64-pc-windows-msvc.exe`, probably, check [here](https://doc.rust-lang.org/nightly/rustc/platform-support.html#tier-1-with-host-tools) if you can't figure out your triple).

## Run as Dev

```sh
cargo tauri dev
```

## Contributing

[![](https://cdn.rawgit.com/jbenet/contribute-ipfs-gif/master/img/contribute.gif)](https://github.com/ipfs/community/blob/master/CONTRIBUTING.md)

We ❤️ all our contributors; this project wouldn’t be what it is without you! If you want to help out, please see [ipfs/community/CONTRIBUTING.md](https://github.com/ipfs/community/blob/master/CONTRIBUTING.md).

This repository falls under the IPFS [Code of Conduct](https://github.com/ipfs/community/blob/master/code-of-conduct.md).

Please reach out to us in one of our [chat](https://docs.ipfs.tech/community/chat/) rooms.
