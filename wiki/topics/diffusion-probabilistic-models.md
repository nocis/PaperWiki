---
slug: diffusion-probabilistic-models
name: Diffusion Probabilistic Models
definition: >-
  Generative models that define a data distribution as the endpoint of a learned
  reverse diffusion process, which gradually denoises a simple prior
  distribution into structured data. The framework originally uses a Markov
  chain, but can be generalized to non-Markovian forward processes, enabling
  tractable sampling, likelihood evaluation, and posterior inference.
mode: standalone
parent_milestone: null
children: []
subtopics: []
tags:
  - generative-models
  - unsupervised-learning
  - markov-chains
  - deep-learning
  - thermodynamics
---
## Definition
Generative models that define a data distribution as the endpoint of a learned reverse diffusion process, which gradually denoises a simple prior distribution into structured data. The framework originally uses a Markov chain, but can be generalized to non-Markovian forward processes, enabling tractable sampling, likelihood evaluation, and posterior inference.

## Key Properties
- Defines generative models as the endpoint of a learned reverse diffusion process, enabling extreme flexibility with tractable probability evaluation, exact sampling, and posterior multiplication. [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Derives a Jensen lower bound on log-likelihood that reduces density estimation to regression of per-step mean/covariance or bit-flip functions. [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Shows Gaussian and binomial diffusion reversals have the same functional form, allowing training of models with thousands of time steps. [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Introduces a method to multiply a trained diffusion distribution by arbitrary second distributions, enabling denoising and inpainting via posterior sampling. [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Provides analytic upper and lower entropy bounds on reverse steps and a differentiable training bound, including learning the Gaussian diffusion schedule via frozen noise. [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Achieves state-of-the-art dead leaves log-likelihood and competitive MNIST/CIFAR-10 results, with an open-source reference implementation. [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Generalizes the Markovian diffusion framework to a family of non-Markovian forward processes that share the same marginal distributions, yielding an equivalent training objective. [[denoising-diffusion-implicit-models]]
- Introduces DDIM, a deterministic implicit probabilistic model obtained by setting the noise scale to zero, enabling direct generation from latent variables. [[denoising-diffusion-implicit-models]]
- Enables sampling along shortened subsequences of timesteps, trading computation for quality without retraining, and achieving 10-50x wall-clock speedups. [[denoising-diffusion-implicit-models]]
- Connects deterministic sampling to Euler integration of an ODE, equivalent to a probability-flow ODE from score-based SDEs. [[denoising-diffusion-implicit-models]]
- Demonstrates latent-space interpolation and near-lossless encoding from latent codes, extending the posterior-inference capabilities of diffusion models. [[denoising-diffusion-implicit-models]]
- Represents diffusion models as latent variable models with a fixed forward noising Markov chain and a learned reverse denoising chain, trained by maximizing a variational lower bound. [[denoising-diffusion-probabilistic-models]]
- Introduces an epsilon-prediction parameterization of the reverse process that simplifies the variational bound to an objective resembling denoising score matching, achieving state-of-the-art FID of 3.17 and Inception score 9.46 on CIFAR-10. [[denoising-diffusion-probabilistic-models]]
- Establishes an explicit connection between diffusion model training and denoising score matching across noise levels, and between reverse-time sampling and annealed Langevin dynamics. [[denoising-diffusion-probabilistic-models]]
- Proposes a simplified weighted training objective (L_simple) that improves sample quality over the true variational bound by down-weighting small-noise terms, with ablations showing fixed reverse-process variances and epsilon prediction outperform learned variances and mu prediction. [[denoising-diffusion-probabilistic-models]]
- Demonstrates that diffusion models are naturally interpreted as progressive lossy compression, generalizing autoregressive decoding with a flexible bit ordering. [[denoising-diffusion-probabilistic-models]]

## Source Cluster
- [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — "Deep Unsupervised Learning using Nonequilibrium Thermodynamics" (Proceedings of the 32nd International Conference on Machine Learning (ICML 2015), JMLR: W&CP volume 37, 2015-07)
- [[denoising-diffusion-implicit-models]] — "Denoising Diffusion Implicit Models" (ICLR 2021 (International Conference on Learning Representations), 2021-05)
- [[denoising-diffusion-probabilistic-models]] — "Denoising Diffusion Probabilistic Models" (34th Conference on Neural Information Processing Systems (NeurIPS 2020), 2020-12)

## Chronological Evolution
- **2015** – [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] introduces diffusion probabilistic models as a Markov chain that gradually destroys data structure and learns to reverse it, with a tractable log-likelihood lower bound and posterior inference capabilities.
- **2020** – [[denoising-diffusion-probabilistic-models]] reframes the training objective with an epsilon-prediction parameterization and a simplified weighted variational bound, links diffusion models to denoising score matching and annealed Langevin dynamics, and demonstrates high-quality generation (FID 3.17 on CIFAR-10), making diffusion models competitive with GANs.
- **2021** – [[denoising-diffusion-implicit-models]] generalizes the Markovian formulation (including the DDPM training setup) to a family of non-Markovian processes with identical marginals, introduces deterministic DDIM sampling, and achieves 10-50x faster sampling from a pretrained DDPM, plus latent interpolation and ODE-based encoding.

## Open Questions
_None recorded._
