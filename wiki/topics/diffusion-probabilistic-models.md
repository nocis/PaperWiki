---
slug: diffusion-probabilistic-models
name: Denoising Diffusion Probabilistic Models
definition: >-
  Denoising diffusion probabilistic models (DDPMs) are a class of deep
  generative models that generate data by progressively reversing a Markovian
  diffusion process that destroys data structure, a framework introduced in
  nonequilibrium thermodynamics. The original 2015 formulation trains a reverse
  chain by optimizing a variational lower bound with per-step Gaussian
  regressions; DDPM (2020) reparame…
mode: standalone
parent_milestone: null
children: []
subtopics: []
tags:
  - generative models
  - diffusion
  - score matching
  - image generation
---
## Definition
Denoising diffusion probabilistic models (DDPMs) are a class of deep generative models that generate data by progressively reversing a Markovian diffusion process that destroys data structure, a framework introduced in nonequilibrium thermodynamics. The original 2015 formulation trains a reverse chain by optimizing a variational lower bound with per-step Gaussian regressions; DDPM (2020) reparameterized the objective to predict noise and simplified its weighting, linking it to denoising score matching; later non-Markovian/implicit DDIM variants accelerate sampling while reusing the same training objective.

## Key Properties
- Introduced diffusion probabilistic models, defining a probability distribution as the finite-time reversal of a Markov diffusion chain rather than through an intractable normalized potential [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Derived a tractable variational lower bound on log-likelihood, reducing learning to regression on per-step Gaussian means/covariances or binomial flip probabilities [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Enables exact sampling, cheap log-likelihood evaluation, and direct multiplication with other distributions for posterior inference tasks such as denoising and inpainting [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Demonstrated training deep generative models with thousands of time steps on MNIST, CIFAR-10, bark, dead leaves, and binary sequences [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Provided analytic upper and lower bounds on reverse-process entropy and learned the forward diffusion schedule via gradient ascent [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Establishes that diffusion models can generate high-quality images, achieving CIFAR10 FID 3.17/IS 9.46 and LSUN samples comparable to ProgressiveGAN [[denoising-diffusion-probabilistic-models]]
- Introduces an epsilon-prediction reparameterization of the reverse process mean, revealing equivalence with denoising score matching over multiple noise scales [[denoising-diffusion-probabilistic-models]]
- Proposes a simplified weighted variational objective (L_simple) that discards per-term weighting, yielding better sample quality than the true variational bound [[denoising-diffusion-probabilistic-models]]
- Fixes forward process variances as constants and uses a U-Net backbone with shared sinusoidal time embeddings, enabling simple and stable training [[denoising-diffusion-probabilistic-models]]
- Interprets sampling as progressive lossy decompression, showing that most bits describe imperceptible details and connecting to autoregressive decoding [[denoising-diffusion-probabilistic-models]]
- Ablations show epsilon prediction with the simplified objective outperforms mu prediction and learned variance parameterizations [[denoising-diffusion-probabilistic-models]]
- Shows the DDPM objective depends only on marginals q(x_t|x_0), enabling a family of non-Markovian inference processes with the same surrogate loss [[denoising-diffusion-implicit-models]]
- Introduces DDIM, a deterministic implicit probabilistic model obtained by setting σ→0, which can reuse pretrained DDPMs without retraining [[denoising-diffusion-implicit-models]]
- Achieves 10–50× wall-clock speedups over DDPM sampling while keeping comparable FID on CIFAR-10 and CelebA [[denoising-diffusion-implicit-models]]
- Demonstrates a consistency property: fixed latent x_T preserves high-level image features across different sampling trajectories, enabling semantic interpolation in latent space [[denoising-diffusion-implicit-models]]
- Connects the DDIM update to Euler integration of an ODE, allowing near-lossless encoding/reconstruction of images and linking to probability-flow ODEs [[denoising-diffusion-implicit-models]]

## Source Cluster
- [[denoising-diffusion-implicit-models]] — "Denoising Diffusion Implicit Models" (ICLR 2021, 2021-05)
- [[denoising-diffusion-probabilistic-models]] — "Denoising Diffusion Probabilistic Models" (NeurIPS 2020, 2020-12)
- [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — "Deep Unsupervised Learning using Nonequilibrium Thermodynamics" (ICML 2015, 2015-07)

## Chronological Evolution
- 2015-07: [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] introduces the diffusion probabilistic model framework: data is generated by reversing a Markov chain that gradually destroys structure. Training optimizes a variational lower bound, reducing density estimation to regression on per-step diffusion kernels, and yields exact sampling and analytic likelihoods, though sample quality was initially limited.
- 2020-12: [[denoising-diffusion-probabilistic-models]] builds on the 2015 framework by reparameterizing the reverse process to predict noise, simplifying the weighted variational objective, and pairing it with a U-Net and fixed forward variances. This makes diffusion models competitive with GANs on image generation (CIFAR-10 FID 3.17) and connects training to denoising score matching.
- 2021-05: [[denoising-diffusion-implicit-models]] observes that DDPM's training loss depends only on the marginals q(x_t|x_0), so the Markovian reverse chain can be replaced by a family of non-Markovian processes. The deterministic DDIM sampler achieves 10–50× speedup by reusing pretrained DDPMs, and its consistency property enables latent-space interpolation and ODE-based encoding/reconstruction.

## Open Questions
_None recorded._
