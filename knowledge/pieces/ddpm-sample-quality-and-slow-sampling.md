---
slug: ddpm-sample-quality-and-slow-sampling
kind: chat
source: chat-2026-08-04T17:00:00.000Z
addedAt: "2026-08-04"
updatedAt: "2026-08-04T17:00:00.000Z"
tags:
  - diffusion
topics:
  - sampling
  - diffusion-evolution
---

DDPM generative samples are high quality, but the Markov-chain sampling procedure is slow — it needs the full reverse chain (often 1000 steps) to denoise.

My take: the sampling procedure is the bottleneck of diffusion models, not the training objective. Training loss looks like a simple denoising score matching, but sampling inherits a sequential dependency that limits real-time use.

This connects to why later work focuses on accelerating sampling while keeping the same trained model.
