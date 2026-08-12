---
slug: diffusion-probabilistic-models
name: Diffusion Probabilistic Models
definition: >-
  Generative models that learn to reverse a forward process which gradually adds
  noise to data, encompassing the original Markov chain formulation (diffusion
  probabilistic models), the high-quality DDPM variant trained with a simplified
  noise-prediction objective, and non-Markovian implicit generalizations
  (denoising diffusion implicit models), enabling tractable or accelerated
  sampling, likelihood…
mode: standalone
parent_milestone: null
children: []
subtopics: []
tags:
  - generative-modeling
  - deep-unsupervised-learning
  - markov-chains
  - nonequilibrium-thermodynamics
  - likelihood-based
---
## Definition
Generative models that learn to reverse a forward process which gradually adds noise to data, encompassing the original Markov chain formulation (diffusion probabilistic models), the high-quality DDPM variant trained with a simplified noise-prediction objective, and non-Markovian implicit generalizations (denoising diffusion implicit models), enabling tractable or accelerated sampling, likelihood evaluation, posterior conditioning, progressive lossy compression, and latent-space manipulation.

## Key Properties
- Defines the data distribution as the endpoint of a Markov chain that gradually destroys structure, with the model being the learned finite-time reversal of that chain [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Reduces training to per-step regression of Gaussian (mean/covariance) or binomial (bit-flip) kernels, using a Jensen lower bound on log-likelihood expressed through tractable KL divergences [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Provides a method to multiply the learned distribution by arbitrary positive functions via perturbed diffusion kernels, enabling easy posterior sampling for denoising and inpainting [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Achieves exact sampling, cheap probability evaluation, and models with thousands of time steps, with state-of-the-art likelihoods on dead leaves and competitive results on MNIST and CIFAR-10 [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Reparameterizes the reverse process to predict noise rather than the posterior mean, establishing a connection between diffusion models and denoising score matching with Langevin dynamics [[denoising-diffusion-probabilistic-models]]
- Introduces a simplified, unweighted variational objective that improves sample quality and stabilizes training relative to the full variational bound [[denoising-diffusion-probabilistic-models]]
- Achieves state-of-the-art unconditional image synthesis (FID 3.17 on CIFAR10), comparable to ProgressiveGAN on LSUN 256x256, establishing diffusion models as a high-fidelity generative family [[denoising-diffusion-probabilistic-models]]
- Shows that diffusion decoding naturally induces progressive lossy compression, interpreted as a generalization of autoregressive decoding over a flexible bit ordering [[denoising-diffusion-probabilistic-models]]
- Demonstrates via ablations that fixed reverse-process variances outperform learned diagonal variances and that epsilon prediction is critical for the simplified objective [[denoising-diffusion-probabilistic-models]]
- Introduces non-Markovian forward processes whose variational objective is equivalent to the DDPM training objective, enabling one pretrained DDPM network to be reused for many sampling procedures [[denoising-diffusion-implicit-models]]
- Defines DDIM, a deterministic implicit probabilistic model (σ=0) that samples with the same network but 10×–50× fewer steps, retaining high FID [[denoising-diffusion-implicit-models]]
- Enables smooth computation–quality trade-offs by selecting the sampling trajectory length τ and stochasticity η [[denoising-diffusion-implicit-models]]
- Shows consistency: fixed latent x_T yields similar high-level sample features across different trajectory lengths, enabling semantically meaningful latent interpolation [[denoising-diffusion-implicit-models]]
- Connects DDIM sampling to Euler integration of an ODE, allowing near-lossless encoding and reconstruction of observations from latent codes [[denoising-diffusion-implicit-models]]

## Source Cluster
- [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — "Deep Unsupervised Learning using Nonequilibrium Thermodynamics" (Proceedings of the 32nd International Conference on Machine Learning (ICML 2015), JMLR W&CP volume 37, Lille, France, 2015-07)
- [[denoising-diffusion-implicit-models]] — "Denoising Diffusion Implicit Models" (ICLR 2021, 2021-05)
- [[denoising-diffusion-probabilistic-models]] — "Denoising Diffusion Probabilistic Models" (34th Conference on Neural Information Processing Systems (NeurIPS 2020), Vancouver, Canada, 2020-12)

## Chronological Evolution
- **2015 - [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]**: Introduces diffusion probabilistic models as a Markov chain that gradually destroys structure, with learned reverse process; provides tractable training via KL divergence and enables exact sampling, likelihood evaluation, and posterior conditioning.
- **2020 - [[denoising-diffusion-probabilistic-models]]**: Revives diffusion models for high-quality synthesis; reparameterizes the reverse process to predict noise, introduces a simplified unweighted objective, and shows the connection to denoising score matching with Langevin dynamics; achieves state-of-the-art FID on CIFAR10, establishes progressive lossy compression, and provides the training recipe that later implicit models build upon.
- **2021 - [[denoising-diffusion-implicit-models]]**: Builds on the DDPM training objective but replaces the Markovian forward process with non-Markovian processes whose variational objective is equivalent; introduces a deterministic sampler (DDIM) that runs 10–50× faster, supports computation–quality trade-offs, and connects sampling to ODE integration for latent-space interpolation and near-lossless reconstruction.

## Open Questions
_None recorded._
