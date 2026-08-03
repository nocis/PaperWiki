---
slug: denoising-diffusion-implicit-models
title: Denoising Diffusion Implicit Models
authors:
  - Jiaming Song
  - Chenlin Meng
  - Stefano Ermon
venue: ICLR 2021
publishedAt: 2021-05
tags:
  - year/2021-05
  - venue/ICLR-2021
milestone: diffusion-probabilistic-models
subtopic: null
numPages: 22
addedAt: '2026-08-03'
rawPath: papers/compiled/denoising-diffusion-implicit-models.pdf
pdfUrl: /pdfs/denoising-diffusion-implicit-models.pdf
cites:
  - denoising-diffusion-probabilistic-models
citedBy: []
---
## Essence
Denoising Diffusion Implicit Models (DDIMs) accelerate sampling from diffusion models by replacing the Markovian generative chain with a family of non-Markovian processes that share DDPM's training objective. The resulting deterministic sampler reuses pretrained DDPMs and can generate high-quality images in 20–100 steps instead of 1000. DDIMs also yield consistent latent encodings, enabling semantic interpolation and ODE-based reconstruction.

## Contributions
- Shows the DDPM objective depends only on marginals q(x_t|x_0), enabling a family of non-Markovian inference processes with the same surrogate loss.
- Introduces DDIM, a deterministic implicit probabilistic model obtained by setting σ→0, which can reuse pretrained DDPMs without retraining.
- Achieves 10–50× wall-clock speedups over DDPM sampling while keeping comparable FID on CIFAR-10 and CelebA.
- Demonstrates a consistency property: fixed latent x_T preserves high-level image features across different sampling trajectories, enabling semantic interpolation in latent space.
- Connects the DDIM update to Euler integration of an ODE, allowing near-lossless encoding/reconstruction of images and linking to probability-flow ODEs.

## Critical Analysis
**Novel Insight**: The core insight is that DDPMs' variational objective is insensitive to the joint inference distribution: it only constrains the marginal q(x_t|x_0). This freedom allows constructing deterministic (implicit) generative processes from the same network, converting diffusion models from stochastic simulators into ODE-based deterministic maps from noise to data.

**Fundamental Limitations**: DDIM trades stochasticity for determinism: with very short trajectories (e.g., 10 steps) sample quality degrades and FID worsens; deterministic sampling may also reduce sample diversity and cannot cover modes in the same stochastic way. The ODE perspective inherits discretization errors, and σ=0 is only a limit of the theorem. The paper primarily evaluates on image datasets; extending to other domains remains future work.

**Research Frontier**: This paper opened the fast-sampling branch of diffusion models by recasting generation as an ODE. Subsequent work improves numerical solvers, derives more efficient DPM-Solvers, deterministic consistency models, and latent diffusion; DDIM's latent-space consistency also underpins diffusion-based editing, inversion, and interpolation. The equivalence to probability-flow SDEs connects score-based and diffusion models.

## Relations
DDIM appears immediately after DDPM (Ho et al., 2020) and NCSN (Song & Ermon, 2019), which produce high-quality samples but require thousands of Langevin/diffusion steps. Song, Meng & Ermon show that the DDPM objective only fixes the marginals of the corruption process, so a non-Markovian deterministic sampler can reuse the same network and cut sampling cost by 10–50×. This work simultaneously connects to the concurrent probability-flow ODE of Song et al. (2020), establishing the ODE-based deterministic sampling viewpoint that underpins later fast samplers and latent-space diffusion methods.

- **extends** [[denoising-diffusion-probabilistic-models]] — Generalizes DDPM's Markovian diffusion to non-Markovian processes while keeping the training objective; enables deterministic sampling.

## References
1. Martin Arjovsky, Soumith Chintala, and Léon Bottou. Wasserstein GAN. arXiv preprint arXiv:1701.07875, January 2017.
2. David Bau, Jun-Yan Zhu, Jonas Wulff, William Peebles, Hendrik Strobelt, Bolei Zhou, and Antonio Torralba. Seeing what a gan cannot generate. In Proceedings of the IEEE International Conference on Computer Vision, pp. 4502–4511, 2019.
3. Yoshua Bengio, Eric Laufer, Guillaume Alain, and Jason Yosinski. Deep generative stochastic networks trainable by backprop. In International Conference on Machine Learning, pp. 226–234, January 2014.
4. Christopher M Bishop. Pattern recognition and machine learning. springer, 2006.
5. Andrew Brock, Jeff Donahue, and Karen Simonyan. Large scale GAN training for high fidelity natural image synthesis. arXiv preprint arXiv:1809.11096, September 2018.
6. John Charles Butcher and Nicolette Goodwin. Numerical methods for ordinary differential equations, volume 2. Wiley Online Library, 2008.
7. Nanxin Chen, Yu Zhang, Heiga Zen, Ron J Weiss, Mohammad Norouzi, and William Chan. WaveGrad: Estimating gradients for waveform generation. arXiv preprint arXiv:2009.00713, September 2020.
8. Ricky T Q Chen, Yulia Rubanova, Jesse Bettencourt, and David Duvenaud. Neural ordinary differential equations. arXiv preprint arXiv:1806.07366, June 2018.
9. Laurent Dinh, Jascha Sohl-Dickstein, and Samy Bengio. Density estimation using real NVP. arXiv preprint arXiv:1605.08803, May 2016.
10. Ian Goodfellow, Jean Pouget-Abadie, Mehdi Mirza, Bing Xu, David Warde-Farley, Sherjil Ozair, Aaron Courville, and Yoshua Bengio. Generative adversarial nets. In Advances in neural information processing systems, pp. 2672–2680, 2014.
11. Anirudh Goyal, Nan Rosemary Ke, Surya Ganguli, and Yoshua Bengio. Variational walkback: Learning a transition operator as a stochastic recurrent net. In Advances in Neural Information Processing Systems, pp. 4392–4402, 2017.
12. Will Grathwohl, Ricky T Q Chen, Jesse Bettencourt, Ilya Sutskever, and David Duvenaud. FFJORD: Free-form continuous dynamics for scalable reversible generative models. arXiv preprint arXiv:1810.01367, October 2018.
13. Ishaan Gulrajani, Faruk Ahmed, Martin Arjovsky, Vincent Dumoulin, and Aaron C Courville. Improved training of wasserstein gans. In Advances in Neural Information Processing Systems, pp. 5769–5779, 2017.
14. Martin Heusel, Hubert Ramsauer, Thomas Unterthiner, Bernhard Nessler, and Sepp Hochreiter. GANs trained by a two Time-Scale update rule converge to a local nash equilibrium. arXiv preprint arXiv:1706.08500, June 2017.
15. Jonathan Ho, Ajay Jain, and Pieter Abbeel. Denoising diffusion probabilistic models. arXiv preprint arXiv:2006.11239, June 2020. → [[denoising-diffusion-probabilistic-models]]
16. Aapo Hyvärinen. Estimation of Non-Normalized statistical models by score matching. Journal of Machine Learning Research, 6:695–709, 2005.
17. Alexia Jolicoeur-Martineau, Rémi Piché-Taillefer, Rémi Tachet des Combes, and Ioannis Mitliagkas. Adversarial score matching and improved sampling for image generation. September 2020.
18. Richard Jordan, David Kinderlehrer, and Felix Otto. The variational formulation of the fokker–planck equation. SIAM journal on mathematical analysis, 29(1):1–17, 1998.
19. Tero Karras, Samuli Laine, and Timo Aila. A Style-Based generator architecture for generative adversarial networks. arXiv preprint arXiv:1812.04948, December 2018.
20. Tero Karras, Samuli Laine, Miika Aittala, Janne Hellsten, Jaakko Lehtinen, and Timo Aila. Analyzing and improving the image quality of stylegan. In Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition, pp. 8110–8119, 2020.
21. Diederik P Kingma and Max Welling. Auto-Encoding variational bayes. arXiv preprint arXiv:1312.6114v10, December 2013.
22. Daniel Levy, Matthew D Hoffman, and Jascha Sohl-Dickstein. Generalizing hamiltonian monte carlo with neural networks. arXiv preprint arXiv:1711.09268, 2017.
23. Shakir Mohamed and Balaji Lakshminarayanan. Learning in implicit generative models. arXiv preprint arXiv:1610.03483, October 2016.
24. Radford M Neal et al. Mcmc using hamiltonian dynamics. Handbook of markov chain monte carlo, 2(11):2, 2011.
25. Alejandro F Queiruga, N Benjamin Erichson, Dane Taylor, and Michael W Mahoney. Continuous-in-depth neural networks. arXiv preprint arXiv:2008.02389, 2020.

## Feeds
milestone: [[diffusion-probabilistic-models]]
