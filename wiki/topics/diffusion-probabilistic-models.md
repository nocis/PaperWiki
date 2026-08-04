---
slug: diffusion-probabilistic-models
name: Diffusion Probabilistic Models
definition: >-
  Generative models that define a data distribution as the endpoint of a Markov
  chain which gradually destroys structure through forward diffusion, and learn
  a reverse diffusion process to restore it; DDPMs make this practical with a
  variational-trained reparameterized reverse chain for high-quality synthesis,
  and later generalizations replace the Markovian forward process with
  non-Markovian proces…
mode: standalone
parent_milestone: null
children: []
subtopics: []
tags:
  - deep generative models
  - diffusion probabilistic models
  - unsupervised learning
  - nonequilibrium thermodynamics
  - density estimation
---
## Definition
Generative models that define a data distribution as the endpoint of a Markov chain which gradually destroys structure through forward diffusion, and learn a reverse diffusion process to restore it; DDPMs make this practical with a variational-trained reparameterized reverse chain for high-quality synthesis, and later generalizations replace the Markovian forward process with non-Markovian processes with identical marginals, enabling deterministic ODE-like sampling while retaining tractable likelihoods and posterior inference.

## Key Properties
- Defines generative models as the finite-time reversal of a Markov diffusion chain, avoiding intractable normalization constants of flexible energy-based models [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Derives a Jensen lower bound on log likelihood that reduces density estimation to regression on per-step Gaussian or binomial diffusion kernels [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Achieves both flexibility and tractability, enabling exact sampling and cheap probability evaluation in models with thousands of layers [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Supports multiplying a learned distribution by arbitrary factors, allowing posterior sampling for denoising and inpainting [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Demonstrates state-of-the-art dead-leaves log likelihood and competitive MNIST/CIFAR-10 performance against GANs, MCGSMs, and GSNs [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Bridges nonequilibrium thermodynamics and annealed importance sampling with deep generative model training [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
- Introduces denoising diffusion probabilistic models (DDPMs) as a parameterized Markov chain trained with variational inference to reverse a fixed Gaussian diffusion process [[denoising-diffusion-probabilistic-models]]
- Shows that diffusion models can synthesize high-quality images, achieving state-of-the-art FID 3.17 and IS 9.46 on unconditional CIFAR10, surpassing most published GAN results at the time [[denoising-diffusion-probabilistic-models]]
- Derives an epsilon-prediction reparameterization of the reverse process that is equivalent to denoising score matching over multiple noise levels and to annealed Langevin dynamics during sampling [[denoising-diffusion-probabilistic-models]]
- Proposes a simplified, unweighted mean-squared-error training objective (L_simple) that improves sample quality over the full variational bound, and shows fixed variances outperform learned diagonal variances [[denoising-diffusion-probabilistic-models]]
- Interprets the variational bound as progressive lossy compression, showing diffusion models allocate most bits to imperceptible details and act as excellent lossy compressors [[denoising-diffusion-probabilistic-models]]
- Establishes a connection between Gaussian diffusion and autoregressive decoding with a generalized bit ordering that cannot be expressed by reordering data coordinates [[denoising-diffusion-probabilistic-models]]
- Generalizes DDPMs to a family of non-Markovian forward processes whose marginals match DDPM's, preserving the same surrogate training objective (Theorem 1) [[denoising-diffusion-implicit-models]]
- Introduces DDIM, a deterministic implicit generative model that reuses a pretrained DDPM network without retraining [[denoising-diffusion-implicit-models]]
- Enables 10x-50x faster sampling (10-100 steps) while matching or exceeding DDPM sample quality at those step counts [[denoising-diffusion-implicit-models]]
- Shows latent-space consistency: the same latent x_T yields similar high-level features across different sampling trajectories, enabling meaningful interpolation and low-error reconstruction via ODE-like encoding [[denoising-diffusion-implicit-models]]
- Connects the discrete iterative process to a neural ODE and to the probability-flow ODE of concurrent score-based SDE work [[denoising-diffusion-implicit-models]]

## Source Cluster
- [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — "Deep Unsupervised Learning using Nonequilibrium Thermodynamics" (ICML 2015 (JMLR W&CP volume 37), 2015-07)
- [[denoising-diffusion-implicit-models]] — "Denoising Diffusion Implicit Models" (ICLR 2021, 2021-05)
- [[denoising-diffusion-probabilistic-models]] — "Denoising Diffusion Probabilistic Models" (34th Conference on Neural Information Processing Systems (NeurIPS 2020), 2020-12)

## Chronological Evolution
- **2015-07** — [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] introduces diffusion probabilistic models: a Markovian forward process gradually destroys data structure, and a learned reverse process restores it. Training maximizes a lower bound on log likelihood; the framework enables exact sampling, cheap likelihood evaluation, and posterior inference.
- **2020-12** — [[denoising-diffusion-probabilistic-models]] builds on this framework and makes it practically powerful: a fixed Gaussian forward process combined with a parameterized reverse chain trained via variational inference yields state-of-the-art image generation (FID 3.17 on CIFAR10). Its epsilon-prediction reparameterization links diffusion models to denoising score matching and annealed Langevin dynamics, and its simplified objective becomes the standard DDPM training loss. It also interprets the diffusion bound as progressive lossy compression, connecting to autoregressive decoding.
- **2021-05** — [[denoising-diffusion-implicit-models]] builds directly on pretrained DDPMs, generalizing the forward process to a family of non-Markovian processes that share the same marginals and training objective. It introduces a deterministic generative process (DDIM) that yields 10x-50x faster sampling, latent-space consistency, meaningful interpolation, and low-error reconstruction, and connects iterative sampling to neural ODEs and the probability-flow ODE of concurrent score-based SDE work.

## Open Questions
_None recorded._
