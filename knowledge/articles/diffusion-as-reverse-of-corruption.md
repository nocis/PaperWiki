---
slug: diffusion-as-reverse-of-corruption
title: Diffusion as Reverse of Corruption
compiledAt: '2026-08-04T19:06:34.471Z'
pieceSlugs:
  - diffusion-as-reverse-of-corruption-process
paperSlugs:
  - deep-unsupervised-learning-using-nonequilibrium-thermodynamics
relatedArticles: []
favorite: true
---
## Definition
Diffusion models corrupt data into noise through a fixed forward process, then learn a reverse process that generates data by undoing that corruption.

## Synthesis
Diffusion models are built on a two-stage idea: a fixed forward process progressively corrupts data into noise, and a learned reverse process attempts to invert that corruption so that samples drawn from noise approximate the original data distribution [[diffusion-as-reverse-of-corruption-process]]. Sohl-Dickstein originally grounded this framework in nonequilibrium thermodynamics: the forward corruption behaves like thermodynamic diffusion moving toward equilibrium, i.e., maximum entropy or pure noise [[diffusion-as-reverse-of-corruption-process]]. The key interpretative move in this article is to treat the reverse process as the actual generative model; the forward process is not itself generative but acts as a training-target constructor [[diffusion-as-reverse-of-corruption-process]]. In other words, the forward chain specifies the sequence of corruptions that the reverse network must learn to undo [[diffusion-as-reverse-of-corruption-process]].

## Wiki Grounding
- **Supports** [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — The original paper grounds diffusion probabilistic models in nonequilibrium thermodynamics and describes a forward noising process that the reverse process learns to invert, matching the article's central framing.
- **Supports** [[denoising-diffusion-probabilistic-models]] — DDPMs formalize diffusion as a fixed forward noising Markov chain with a learned reverse denoising chain, directly supporting the article's claim that the forward process defines the training target while the reverse generates data.
- **Supports** [[denoising-diffusion-implicit-models]] — DDIMs generalize the forward process beyond the Markovian case while retaining the corruption-and-reverse-generation paradigm, so the article's broad corruption-reversal view remains supported even though the article does not discuss this variant.

## Academic Review
**Novelty Assessment**: The main novel contribution is the researcher's own framing that the forward process is 'just a training target constructor' — an interpretive lens that privileges the reverse process as the generative model. This is a conceptual clarification rather than a new mathematical result, since the reverse-as-generative idea is already present in the literature.

**Critique**: The article makes an unsupported generalization by calling the forward process 'just a training target constructor,' which downplays how the forward process determines the variational objective and the feasibility of learning the reverse chain. The piece provides no derivations or empirical evidence, and the thermodynamic analogy is presented at a high level without fully explaining the connection to maximum entropy or pure noise.

**Limitations**: This article cannot claim to explain the training objective, the ELBO, noise schedules, or tractability conditions of diffusion models. It also does not address non-Markovian or implicit variants such as DDIM, nor does it provide evidence of generative quality or theoretical guarantees.

**Research Frontier**: Natural next steps include formalizing the forward chain as an optimizable training target, studying how different corruption schedules affect learned reverse generation, extending the corruption-reversal viewpoint to non-Markovian or deterministic processes, and investigating why a simple fixed corruption process enables such effective generative models.

## Related Articles
_None._
