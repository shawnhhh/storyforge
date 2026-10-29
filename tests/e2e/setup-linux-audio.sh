#!/usr/bin/env bash
# Headless Firefox needs an audio output clock even when all media is synthetic.
# A per-runner null sink supplies it without microphones or physical devices.
set -euo pipefail
if ! command -v pulseaudio >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y pulseaudio
fi
pulseaudio --check || pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=storyforge sink_properties=device.description=StoryForge
pactl set-default-sink storyforge
pactl info
