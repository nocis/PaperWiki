---
slug: deep-unsupervised-learning-using-nonequilibrium-thermodynamics
title: Deep Unsupervised Learning using Nonequilibrium Thermodynamics
authors:
  - Jascha Sohl-Dickstein
  - Eric A. Weiss
  - Niru Maheswaranathan
  - Surya Ganguli
venue: ICML 2015
publishedAt: 2015-07
tags:
  - year/2015-07
  - venue/ICML-2015
milestone: diffusion-probabilistic-models
subtopic: null
numPages: 18
addedAt: '2026-08-03'
rawPath: >-
  papers/compiled/deep-unsupervised-learning-using-nonequilibrium-thermodynamics.pdf
pdfUrl: /pdfs/deep-unsupervised-learning-using-nonequilibrium-thermodynamics.pdf
cites: []
citedBy: []
---
## Essence
This paper introduces diffusion probabilistic models, defining a generative model as the reversal of a gradual Markovian diffusion process that destroys data structure. Training optimizes a variational lower bound on the log-likelihood, reducing density estimation to regression on per-step diffusion kernels. The framework yields flexible but tractable deep generative models with exact sampling and analytic probability evaluation.

## Contributions
- Introduced diffusion probabilistic models, defining a probability distribution as the finite-time reversal of a Markov diffusion chain rather than through an intractable normalized potential.
- Derived a tractable variational lower bound on log-likelihood, reducing learning to regression on per-step Gaussian means/covariances or binomial flip probabilities.
- Enabled exact sampling, cheap log-likelihood evaluation, and direct multiplication with other distributions for posterior inference tasks such as denoising and inpainting.
- Showed how to train deep generative models with thousands of time steps on diverse data, including MNIST, CIFAR-10, bark, dead leaves, and binary sequences.
- Provided analytic upper and lower bounds on reverse-process entropy and demonstrated learning of the forward diffusion schedule via gradient ascent.

## Critical Analysis
**Novel Insight**: The core insight is that a generative model can be explicitly defined as the endpoint of a learned reversal of a fixed forward diffusion process. Because each forward step is a simple, analytically tractable kernel and the diffusion rate is small, the reverse transition has the same functional form and can be estimated as a small perturbation rather than as a globally intractable density. This reframes density estimation as a sequence of local regression problems, making extremely deep probabilistic models trainable while preserving exact sampling and probability evaluation.

**Fundamental Limitations**: The training objective is a lower bound on log-likelihood, and the bound is tight only in the quasi-static limit of infinitesimal diffusion steps; finite-time chains leave a gap. The binomial diffusion schedule is not learned by gradient descent, unlike the Gaussian case. Very long trajectories (e.g., 1000 steps) are computationally expensive, and the original experiments use Parzen-window estimates for some likelihood comparisons. Mixed results on datasets like CIFAR-10 and MNIST show that early diffusion models were competitive but not clearly superior to contemporary GANs, autoregressive models, and GSNs.

**Research Frontier**: This work opens the diffusion generative modeling line, leaving open how to tighten the variational bound, reduce the number of diffusion steps, and learn better schedules. Subsequent work formalizes the connection to score matching, improves reparameterized training objectives, and develops non-Markovian accelerated samplers. The framework also suggests deeper links between stochastic differential equations, nonequilibrium thermodynamics, and neural density estimation, which became the basis for modern diffusion models and their many applications in image, audio, and structured generative modeling.

## Relations
This 2015 paper is the origin of the diffusion probabilistic model line, predating the existing wiki entries denoising-diffusion-probabilistic-models (DDPM, 2020) and denoising-diffusion-implicit-models (DDIM, 2021). It adapts ideas from annealed importance sampling and nonequilibrium thermodynamics to define a generative model as the reversal of a Markov diffusion process. DDPM later formalizes the variational bound and simplified training objective, while DDIM accelerates sampling; both directly extend the framework introduced here.

_No relations to existing wiki papers detected._

## References
1. Jarzynski, C. Equilibrium free-energy differences from nonequilibrium measurements: A master-equation approach. Physical Review E, January 1997.
2. Neal, R. Annealed importance sampling. Statistics and Computing, January 2001.
3. Feller, W. On the theory of stochastic processes, with particular reference to applications. In Proceedings of the [First] Berkeley Symposium on Mathematical Statistics and Probability. The Regents of the University of California, 1949.
4. Kingma, D. P. and Welling, M. Auto-Encoding Variational Bayes. International Conference on Learning Representations, December 2013.
5. Rezende, D. J., Mohamed, S., and Wierstra, D. Stochastic Backpropagation and Approximate Inference in Deep Generative Models. Proceedings of the 31st International Conference on Machine Learning (ICML-14), January 2014.
6. Goodfellow, I. J., Pouget-Abadie, J., Mirza, M., Xu, B., Warde-Farley, D., Ozair, S., Courville, A., and Bengio, Y. Generative Adversarial Nets. Advances in Neural Information Processing Systems, 2014.
7. Larochelle, H. and Murray, I. The neural autoregressive distribution estimator. Journal of Machine Learning Research, 2011.
8. Bengio, Y. and Thibodeau-Laufer, E. Deep generative stochastic networks trainable by backprop. arXiv preprint arXiv:1306.1091, 2013.
9. Theis, L., Hosseini, R., and Bethge, M. Mixtures of conditional Gaussian scale mixtures applied to multiscale image representations. PloS one, 7(7):e39857, 2012.
10. Dinh, L., Krueger, D., and Bengio, Y. NICE: Non-linear Independent Components Estimation. arXiv:1410.8516, pp. 11, October 2014.
11. Hinton, G. E. Training products of experts by minimizing contrastive divergence. Neural Computation, 14(8):1771–1800, 2002.
12. Hyvärinen, A. Estimation of non-normalized statistical models using score matching. Journal of Machine Learning Research, 6:695–709, 2005.
13. Welling, M. and Hinton, G. A new learning algorithm for mean field Boltzmann machines. Lecture Notes in Computer Science, January 2002.
14. Sohl-Dickstein, J., Battaglino, P., and DeWeese, M. New Method for Parameter Estimation in Probabilistic Models: Minimum Probability Flow. Physical Review Letters, 107(22):11–14, November 2011a.
15. Sohl-Dickstein, J., Poole, B., and Ganguli, S. Fast large-scale optimization by unifying stochastic gradient and quasi-Newton methods. In Proceedings of the 31st International Conference on Machine Learning (ICML-14), pp. 604–612, 2014.
16. Burda, Y., Grosse, R. B., and Salakhutdinov, R. Accurate and Conservative Estimates of MRF Log-likelihood using Reverse Annealing. arXiv:1412.8566, December 2014.
17. Gregor, K., Danihelka, I., Mnih, A., Blundell, C., and Wierstra, D. Deep AutoRegressive Networks. arXiv preprint arXiv:1310.8499, October 2013.
18. Bornschein, J. and Bengio, Y. Reweighted Wake-Sleep. International Conference on Learning Representations, June 2015.
19. Uria, B., Murray, I., and Larochelle, H. A Deep and Tractable Density Estimator. arXiv:1310.1757, pp. 9, October 2013b.
20. LeCun, Y. and Cortes, C. The MNIST database of handwritten digits. 1998.
21. Krizhevsky, A. and Hinton, G. Learning multiple layers of features from tiny images. Computer Science Department University of Toronto Tech. Rep., 2009.
22. Theis, L., van den Oord, A., and Bethge, M. A note on the evaluation of generative models. arXiv preprint arXiv:1511.01844, 2015.
23. Sminchisescu, C., Kanaujia, A., and Metaxas, D. Learning joint top-down and bottom-up processes for 3D visual inference. In Computer Vision and Pattern Recognition, 2006 IEEE Computer Society Conference on, volume 2, pp. 1743–1752. IEEE, 2006.
24. Stuhlmüller, A., Taylor, J., and Goodman, N. Learning stochastic inverses. Advances in Neural Information Processing Systems, 2013.
25. Spinney, R. and Ford, I. Fluctuation Relations: A Pedagogical Overview. arXiv preprint arXiv:1201.6381, pp. 3–56, 2013.

## Feeds
milestone: [[diffusion-probabilistic-models]]
