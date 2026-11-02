# The Linux build and test image for the Tauri shell: the WebKitGTK 4.1 and
# GTK 3 headers to build it, the pinned Rust toolchain, and what the scripted
# sign-in test (e2e/) runs on: Xvfb, one dbus session, GNOME Keyring for the
# Secret Service, WebKitWebDriver and tauri-driver.
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
      webkit2gtk-driver \
    && rm -rf /var/lib/apt/lists/*

# uid 1000, so a mounted checkout and cargo cache keep their owner.
RUN useradd -m -u 1000 -s /bin/bash builder || usermod -l builder -d /home/builder -m "$(getent passwd 1000 | cut -d: -f1)"
USER builder
ENV PATH=/home/builder/.cargo/bin:$PATH

# The toolchain client/tauri/rust-toolchain.toml names, with its components.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain 1.99.1 -c rustfmt -c clippy

# tauri-driver, the WebDriver front for Tauri apps (it starts WebKitWebDriver).
# Pinned, with its own lockfile; the registry it downloaded is not kept.
RUN cargo install tauri-driver --version 2.1.0 --locked \
    && rm -rf /home/builder/.cargo/registry /home/builder/.cargo/git

WORKDIR /work
