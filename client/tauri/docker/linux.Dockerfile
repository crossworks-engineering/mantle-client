# The Linux build and test image for the Tauri shell: the WebKitGTK 4.1 and
# GTK 3 headers to build it, the pinned Rust toolchain, and what the scripted
# sign-in test (e2e/) runs on: Xvfb, one dbus session, GNOME Keyring for the
# Secret Service, WebKitWebDriver and tauri-driver, and xdotool to answer the
# app's one native alert (WebDriver reaches only the web page).
#
#   docker build -f client/tauri/docker/linux.Dockerfile -t mantle-tauri-linux client/tauri/docker
#
# The build context is this folder alone: nothing from the repo goes into the
# image. Run it with the repo mounted at /work (e2e/run.sh says how).
#
# Ubuntu 24.04, pinned by digest (the multi-arch index).
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates pkg-config libssl-dev file \
      libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
      libsecret-1-dev gnome-keyring dbus dbus-x11 xvfb xauth python3 \
      webkit2gtk-driver xdotool \
    && rm -rf /var/lib/apt/lists/*

# uid 1000, so a mounted checkout and cargo cache keep their owner.
RUN useradd -m -u 1000 -s /bin/bash builder || usermod -l builder -d /home/builder -m "$(getent passwd 1000 | cut -d: -f1)"
USER builder
ENV PATH=/home/builder/.cargo/bin:$PATH

# The toolchain client/tauri/rust-toolchain.toml names, with its components,
# installed by rustup-init at a pinned version whose sha256 is checked here
# (not `curl | sh`). The sums are the ones static.rust-lang.org publishes
# beside each binary, recorded when the pin was set.
ARG RUSTUP_VERSION=1.28.2
ARG RUSTUP_SHA256_X86_64=20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c
ARG RUSTUP_SHA256_AARCH64=e3853c5a252fca15252d07cb23a1bdd9377a8c6f3efa01531109281ae47f841c
RUN set -eu; \
    case "$(uname -m)" in \
      x86_64) arch=x86_64; sum="$RUSTUP_SHA256_X86_64" ;; \
      aarch64) arch=aarch64; sum="$RUSTUP_SHA256_AARCH64" ;; \
      *) echo "no pinned rustup-init for $(uname -m)" >&2; exit 1 ;; \
    esac; \
    curl --proto '=https' --tlsv1.2 -sSf -o /tmp/rustup-init \
      "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${arch}-unknown-linux-gnu/rustup-init"; \
    echo "${sum}  /tmp/rustup-init" | sha256sum -c -; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain 1.99.1 -c rustfmt -c clippy; \
    rm /tmp/rustup-init

# tauri-driver, the WebDriver front for Tauri apps (it starts WebKitWebDriver).
# Pinned, with its own lockfile; the registry it downloaded is not kept.
RUN cargo install tauri-driver --version 2.1.0 --locked \
    && rm -rf /home/builder/.cargo/registry /home/builder/.cargo/git

WORKDIR /work
