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
addedAt: '2026-08-13'
rawPath: papers/compiled/denoising-diffusion-implicit-models.pdf
pdfUrl: /pdfs/denoising-diffusion-implicit-models.pdf
figures:
  - figure_1.png
  - figure_10.png
  - figure_11.png
  - figure_12.png
  - figure_2.png
  - figure_3.png
  - figure_4.png
  - figure_5.png
  - figure_6.png
  - figure_7.png
  - figure_8.png
  - figure_9.png
  - page_1.png
cites:
  - deep-unsupervised-learning-using-nonequilibrium-thermodynamics
  - denoising-diffusion-probabilistic-models
citedBy: []
relations:
  - relation: extends
    slug: deep-unsupervised-learning-using-nonequilibrium-thermodynamics
    note: >-
      Generalizes the diffusion probabilistic model framework to non-Markovian
      forward processes while preserving the variational objective.
  - relation: extends
    slug: denoising-diffusion-probabilistic-models
    note: >-
      Extends DDPM with an implicit, non-Markovian diffusion process enabling
      deterministic and faster sampling.
---
## Essence
The paper introduces denoising diffusion implicit models (DDIMs), a class of iterative implicit probabilistic models that share the training objective of DDPMs but use non-Markovian diffusion processes to enable deterministic, accelerated sampling. DDIMs produce high-quality images 10 to 50 times faster than DDPMs, allow trade-offs between computation and sample quality, support semantically meaningful latent-space interpolation, and can reconstruct observations with low error.

## Contributions
- Introduces a family of non-Markovian forward processes whose variational objective is equivalent to the DDPM training objective, so one pretrained DDPM network can be reused for many sampling procedures.
- Defines DDIM, a deterministic implicit probabilistic model (σ=0) that samples with the same network but 10×–50× fewer steps, retaining high FID.
- Enables smooth computation–quality trade-offs by selecting the sampling trajectory length τ and stochasticity η.
- Shows consistency: fixed latent x_T yields similar high-level sample features across different trajectory lengths, enabling semantically meaningful latent interpolation.
- Connects DDIM sampling to Euler integration of an ODE, allowing near-lossless encoding and reconstruction of observations from latent codes.

## Figures
![Figure 1](/figures/denoising-diffusion-implicit-models/figure_1.png)
![Figure 10](/figures/denoising-diffusion-implicit-models/figure_10.png)
![Figure 11](/figures/denoising-diffusion-implicit-models/figure_11.png)
![Figure 12](/figures/denoising-diffusion-implicit-models/figure_12.png)
![Figure 2](/figures/denoising-diffusion-implicit-models/figure_2.png)
![Figure 3](/figures/denoising-diffusion-implicit-models/figure_3.png)
![Figure 4](/figures/denoising-diffusion-implicit-models/figure_4.png)
![Figure 5](/figures/denoising-diffusion-implicit-models/figure_5.png)
![Figure 6](/figures/denoising-diffusion-implicit-models/figure_6.png)
![Figure 7](/figures/denoising-diffusion-implicit-models/figure_7.png)
![Figure 8](/figures/denoising-diffusion-implicit-models/figure_8.png)
![Figure 9](/figures/denoising-diffusion-implicit-models/figure_9.png)
![Page 1](/figures/denoising-diffusion-implicit-models/page_1.png)

## Critical Analysis
**Novel Insight**: *prior:* DDPMs require simulating the full reverse Markov chain because the generative process approximates the reverse of a fixed forward diffusion; thousands of steps are needed for high sample quality, making sampling far slower than GANs. / *update:* The DDPM training objective depends only on the marginals q(x_t|x_0), not the joint, so the Markovian forward process can be replaced by non-Markovian ones. Setting the stochasticity to zero yields a deterministic implicit model that can be sampled with 10–50× fewer steps, while also enabling latent-space semantics and ODE-based encoding.

**Fundamental Limitations**: Deterministic DDIM is marginally worse than the original DDPM at the full 1000-step setting on CIFAR10 (FID 4.04 vs 3.17 for the noisy DDPM baseline). The σ=0 extreme is not formally covered by Theorem 1 and must be approached as a limit. Accelerated trajectories trade sample quality for speed, and the non-Gaussian discrete extension is only sketched without empirical validation. Reconstruction error decreases with more steps but is not zero, so encoding is approximate.

**Research Frontier**: The connection to neural ODEs suggests applying higher-order ODE solvers (e.g., Adams-Bashforth) to reduce discretization error and improve few-step sample quality. Non-Markovian forward processes beyond Gaussian, such as multinomial processes for discrete/combinatorial structures, remain to be explored empirically. The deterministic latent encodings could be used for downstream tasks requiring meaningful latent representations, and further implicit-model properties (e.g., inversion, editing) are open.

## Relations
Sohl-Dickstein et al. introduced diffusion probabilistic models as latent-variable models with a Markovian forward noising process and a learned reverse chain, and Ho et al. made them generate high-quality images at T=1000 steps. DDIM identifies that the training objective depends only on the marginals q(x_t|x_0), not the joint, and generalizes the forward process to a family of non-Markovian processes that share the same objective. This lets a single pretrained network be sampled with a deterministic, ODE-like procedure that is 10–50× faster, and it supersedes the fixed Markovian generative trajectory as the default efficient sampling choice while leaving training untouched.

- **extends** [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]] — Generalizes the diffusion probabilistic model framework to non-Markovian forward processes while preserving the variational objective.
- **extends** [[denoising-diffusion-probabilistic-models]] — Extends DDPM with an implicit, non-Markovian diffusion process enabling deterministic and faster sampling.
## Citations
_2 of 41 citations linked to compiled papers._

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
26. Martin Raphan and Eero P Simoncelli. Least squares estimation without priors or supervision. Neural computation, 23(2):374–420, February 2011.
27. Danilo Jimenez Rezende and Shakir Mohamed. Variational inference with normalizing flows. arXiv preprint arXiv:1505.05770, May 2015.
28. Danilo Jimenez Rezende, Shakir Mohamed, and Daan Wierstra. Stochastic backpropagation and approximate inference in deep generative models. arXiv preprint arXiv:1401.4082, 2014.
29. Olaf Ronneberger, Philipp Fischer, and Thomas Brox. U-net: Convolutional networks for biomedical image segmentation. In International Conference on Medical image computing and computer-assisted intervention, pp. 234–241. Springer, 2015.
30. Tim Salimans, Diederik P Kingma, and Max Welling. Markov chain monte carlo and variational inference: Bridging the gap. arXiv preprint arXiv:1410.6460, October 2014.
31. Ken Shoemake. Animating rotation with quaternion curves. In Proceedings of the 12th annual conference on Computer graphics and interactive techniques, pp. 245–254, 1985.
32. Jascha Sohl-Dickstein, Eric A Weiss, Niru Maheswaranathan, and Surya Ganguli. Deep unsupervised learning using nonequilibrium thermodynamics. arXiv preprint arXiv:1503.03585, March 2015. → [[deep-unsupervised-learning-using-nonequilibrium-thermodynamics]]
33. Jiaming Song, Shengjia Zhao, and Stefano Ermon. A-nice-mc: Adversarial training for mcmc. arXiv preprint arXiv:1706.07561, June 2017.
34. Yang Song and Stefano Ermon. Generative modeling by estimating gradients of the data distribution. arXiv preprint arXiv:1907.05600, July 2019.
35. Yang Song and Stefano Ermon. Improved techniques for training Score-Based generative models. arXiv preprint arXiv:2006.09011, June 2020.
36. Yang Song, Jascha Sohl-Dickstein, Diederik P Kingma, Abhishek Kumar, Stefano Ermon, and Ben Poole. Score-based generative modeling through stochastic differential equations. arXiv preprint arXiv:2011.13456, 2020.
37. Aaron van den Oord, Sander Dieleman, Heiga Zen, Karen Simonyan, Oriol Vinyals, Alex Graves, Nal Kalchbrenner, Andrew Senior, and Koray Kavukcuoglu. WaveNet: A generative model for raw audio. arXiv preprint arXiv:1609.03499, September 2016a.
38. Aaron van den Oord, Nal Kalchbrenner, and Koray Kavukcuoglu. Pixel recurrent neural networks. arXiv preprint arXiv:1601.06759, January 2016b.
39. Pascal Vincent. A connection between score matching and denoising autoencoders. Neural computation, 23(7):1661–1674, 2011.
40. Sergey Zagoruyko and Nikos Komodakis. Wide residual networks. arXiv preprint arXiv:1605.07146, May 2016.
41. Shengjia Zhao, Hongyu Ren, Arianna Yuan, Jiaming Song, Noah Goodman, and Stefano Ermon. Bias and generalization in deep generative models: An empirical study. In Advances in Neural Information Processing Systems, pp. 10792–10801, 2018.
## Feeds
milestone: [[diffusion-probabilistic-models]]
