---
slug: diffusion-probabilistic-models
name: Diffusion Probabilistic Models
definition: >-
  Generative models that learn to reverse a gradual noising process. A forward
  process (Markovian or non-Markovian) progressively destroys data structure
  into a simple noise distribution, while a learned reverse process restores
  structure. Training optimizes a variational bound on log likelihood, often
  reparameterized as denoising score matching, yielding tractable sampling,
  log-likelihood evaluati…
mode: standalone
parent_milestone: null
children: []
subtopics: []
tags:
  - generative models
  - deep unsupervised learning
  - probabilistic inference
  - diffusion processes
---
## Definition
Generative models that learn to reverse a gradual noising process. A forward process (Markovian or non-Markovian) progressively destroys data structure into a simple noise distribution, while a learned reverse process restores structure. Training optimizes a variational bound on log likelihood, often reparameterized as denoising score matching, yielding tractable sampling, log-likelihood evaluation, posterior manipulation, fast deterministic generation, and high-quality image synthesis.

## Key Properties
- Generative distribution defined as endpoint of a learned reverse Markov chain from noise to data [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Forward Markov chain gradually corrupts data into a simple noise distribution [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Training maximizes a Jensen lower bound on log likelihood, reducing density estimation to regression over per-step diffusion kernel parameters [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Enables exact sampling, cheap log-likelihood evaluation, and easy multiplication with arbitrary distributions for posterior computation (denoising/inpainting) [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Supports models with thousands of time steps/layers, demonstrated on swiss roll, binary sequences, MNIST, CIFAR-10, bark, and dead leaves [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Derives analytic upper/lower bounds on the entropy of each reverse step and learns the forward diffusion schedule via gradient ascent [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Reparameterizes the reverse process to predict the noise (ε-prediction), connecting diffusion training to denoising score matching across noise scales [[denoising-diffusion-probabilistic-models]]
- Simplifies the variational bound to an unweighted mean-squared error objective (L_simple) that improves sample quality despite weakening log-likelihood [[denoising-diffusion-probabilistic-models]]
- Achieves state-of-the-art image synthesis, with FID 3.17 on unconditional CIFAR-10 and matching ProgressiveGAN on LSUN 256×256 [[denoising-diffusion-probabilistic-models]]
- Demonstrates that the sampling chain performs progressive lossy compression, generalizing autoregressive decoding to a continuous bit-ordering [[denoising-diffusion-probabilistic-models]]
- Shows via ablations that predicting noise with fixed variances outperforms predicting the posterior mean or learning variances [[denoising-diffusion-probabilistic-models]]
- Generalizes the forward process to non-Markovian families with the same marginal distributions, showing the DDPM objective depends only on q(x_t|x_0) and not the joint [[denoising-diffusion-implicit-models]]
- Introduces deterministic generative processes (σ=0) that reuse pretrained DDPM networks, enabling 10–50× faster sampling with high quality [[denoising-diffusion-implicit-models]]
- Allows semantically meaningful latent-space interpolation and near-lossless reconstruction via an ODE-like sampling procedure [[denoising-diffusion-implicit-models]]
- Unifies DDPM and score-based sampling under a variational inference perspective [[denoising-diffusion-implicit-models]]

## Source Cluster
- [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — "Deep Unsupervised Learning using Nonequilibrium Thermodynamics" (ICML 2015 (JMLR: W&CP volume 37), 2015-07)
- [[denoising-diffusion-implicit-models]] — "Denoising Diffusion Implicit Models" (ICLR 2021, 2021-05)
- [[denoising-diffusion-probabilistic-models]] — "Denoising Diffusion Probabilistic Models" (34th Conference on Neural Information Processing Systems (NeurIPS 2020), 2020-12)

## Chronological Evolution
- 2015-07: [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] introduces diffusion probabilistic models, defining a forward Markov chain that corrupts data into noise and a learned reverse chain for generation, with a variational bound objective. It establishes tractable sampling, likelihood evaluation, and posterior multiplication, and demonstrates feasibility on toy, binary, and small image datasets.
- 2020-12: [[denoising-diffusion-probabilistic-models]] makes diffusion models practical for high-quality image synthesis by reparameterizing the reverse process to predict the noise (ε-prediction), connecting it to denoising score matching, and simplifying the variational bound to an unweighted MSE objective (L_simple). It achieves FID 3.17 on unconditional CIFAR-10 and matches ProgressiveGAN on LSUN 256×256, and shows the sampling chain is a progressive lossy compressor akin to a generalized autoregressive decoder. This paper becomes the canonical baseline for subsequent diffusion-model research.
- 2021-05: [[denoising-diffusion-implicit-models]] builds on the DDPM formulation by observing that the training objective depends only on the marginal distributions q(x_t|x_0), not the full forward joint. This allows constructing a family of non-Markovian forward processes with the same marginals, including a deterministic generative process (σ→0) that reuses pretrained DDPM networks for 10–50× faster sampling, enables latent-space interpolation, and near-lossless reconstruction via an ODE-like procedure. It also unifies DDPM and score-based sampling under a variational inference perspective, generalizing the framework and influencing subsequent acceleration and inversion techniques.

## Open Questions
_None recorded._
