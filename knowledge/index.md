---
type: index
last_compiled: '2026-08-04T19:19:40.361Z'
last_updated: '2026-08-04'
---
# Knowledge

Your own knowledge, compiled into topic articles and reviewed against the literature wiki (4 pieces · 4 articles).

## Articles

- [[ddim-sampling-acceleration]] — DDIM enables 10-50x faster sampling from pretrained diffusion models by reformulating the reverse chain as non-Markovian/ODE without retraining, at a quality cost. (3 pieces, 2 papers grounded)
  - pieces: [[chat-4-messages]], [[ddim-reinterprets-sampling-as-ode]], [[ddpm-sample-quality-and-slow-sampling]]
- [[diffusion-as-reverse-of-corruption]] — Diffusion models corrupt data into noise through a fixed forward process, then learn a reverse process that generates data by undoing that corruption. (1 piece, 1 paper grounded)
  - pieces: [[diffusion-as-reverse-of-corruption-process]]
- [[diffusion-as-reverse-of-corruption-process]] — Diffusion models generate data by learning to reverse a forward process that gradually corrupts data into noise, inspired by nonequilibrium thermodynamics. (1 piece, 2 papers grounded)
  - pieces: [[diffusion-as-reverse-of-corruption-process]]
- [[diffusion-sampling-and-acceleration]] — Examines why diffusion sampling is slow, how DDIM recasts it as an ODE, and why the trained generative path is underdetermined. (2 pieces, 2 papers grounded)
  - pieces: [[ddim-reinterprets-sampling-as-ode]], [[ddpm-sample-quality-and-slow-sampling]]

## Pieces

- [[chat-4-messages]] — (chat, 2026-08-04) [assistant]
Based on the retrieved wiki pages, I can answer this directly:

**No — DDIM does not accelerate diffusion model *training* (pre-training); it accelerates *sampling* from an already-trained model.**

The key e
- [[ddim-reinterprets-sampling-as-ode]] — (chat, 2026-08-04) DDIM showed the DDPM training objective does not force a specific reverse chain — sampling can be restructured into a non-Markovian process, or interpreted as an ODE trajectory of the data-to-noise process.

Fewer steps 
- [[ddpm-sample-quality-and-slow-sampling]] — (chat, 2026-08-04) DDPM generative samples are high quality, but the Markov-chain sampling procedure is slow — it needs the full reverse chain (often 1000 steps) to denoise.

My take: the sampling procedure is the bottleneck of diffusion m
- [[diffusion-as-reverse-of-corruption-process]] — (chat, 2026-08-04) The diffusion idea: progressively corrupt data into noise (forward process), then learn the reverse transformation to generate data from noise.

Sohl-Dickstein grounded this in nonequilibrium thermodynamics — the forward

## Literature wiki

- [[diffusion-probabilistic-models]] — Generative models that define a data distribution as the endpoint of a learned reverse diffusion process, which gradually denoises a simple prior distribution into structured data. The framework originally uses a Markov chain, but can be generalized to non-Markovian forward processes, enabling tractable sampling, likelihood evaluation, and posterior inference.

_Regenerated from zero on every Knowledge Compile — do not hand-edit._
