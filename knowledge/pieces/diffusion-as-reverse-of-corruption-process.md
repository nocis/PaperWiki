---
slug: diffusion-as-reverse-of-corruption-process
kind: chat
source: chat-2026-08-04T17:00:00.000Z
addedAt: "2026-08-04"
updatedAt: "2026-08-04T17:00:00.000Z"
tags:
  - diffusion
topics:
  - diffusion-evolution
---

The diffusion idea: progressively corrupt data into noise (forward process), then learn the reverse transformation to generate data from noise.

Sohl-Dickstein grounded this in nonequilibrium thermodynamics — the forward corruption resembles a thermodynamic diffusion toward equilibrium (maximum entropy / pure noise).

My understanding: the reverse process is the generative model; the forward process is just a training target constructor. The forward chain defines what the reverse network must learn to undo.
