---
slug: deep-unsupervised-learning-using-nonequilibrium-thermodynamics
title: Deep Unsupervised Learning using Nonequilibrium Thermodynamics
authors:
  - Jascha Sohl-Dickstein
  - Eric A. Weiss
  - Niru Maheswaranathan
  - Surya Ganguli
venue: >-
  Proceedings of the 32nd International Conference on Machine Learning (ICML
  2015), JMLR: W&CP volume 37
publishedAt: 2015-07
tags:
  - year/2015-07
  - >-
    venue/Proceedings-of-the-32nd-International-Conference-on-Machine-Learning-(ICML-2015),-JMLR:-W&CP-volume-37
milestone: diffusion-probabilistic-models
subtopic: null
numPages: 18
addedAt: '2026-08-04'
rawPath: >-
  papers/compiled/deep-unsupervised-learning-using-nonequilibrium-thermodynamics.pdf
pdfUrl: /pdfs/deep-unsupervised-learning-using-nonequilibrium-thermodynamics.pdf
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
cites: []
citedBy:
  - denoising-diffusion-implicit-models
  - denoising-diffusion-probabilistic-models
---
## Essence
Introduces diffusion probabilistic models, a family of deep generative models inspired by nonequilibrium thermodynamics. A fixed forward Markov chain gradually destroys data structure into a tractable Gaussian or binomial distribution, while a learned reverse chain restores it, yielding a model that is flexible yet exactly sampleable, efficiently trainable via a log-likelihood lower bound, and easy to multiply with other distributions for posterior inference. Demonstrated on swiss roll, binary heartbeat, MNIST, CIFAR-10, bark, and dead leaves images.

## Contributions
- Defines generative models as the endpoint of a learned reverse diffusion process, enabling extreme flexibility with tractable probability evaluation, exact sampling, and posterior multiplication.
- Derives a Jensen lower bound on log-likelihood that reduces density estimation to regression of per-step mean/covariance or bit-flip functions.
- Shows Gaussian and binomial diffusion reversals have the same functional form, allowing training of models with thousands of time steps.
- Introduces a method to multiply a trained diffusion distribution by arbitrary second distributions, enabling denoising and inpainting via posterior sampling.
- Provides analytic upper and lower entropy bounds on reverse steps and a differentiable training bound, including learning the Gaussian diffusion schedule via frozen noise.
- Achieves state-of-the-art dead leaves log-likelihood and competitive MNIST/CIFAR-10 results, with an open-source reference implementation.

## Figures
![Figure 1](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_1.png)
![Figure 10](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_10.png)
![Figure 11](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_11.png)
![Figure 12](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_12.png)
![Figure 2](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_2.png)
![Figure 3](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_3.png)
![Figure 4](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_4.png)
![Figure 5](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_5.png)
![Figure 6](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_6.png)
![Figure 7](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_7.png)
![Figure 8](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_8.png)
![Figure 9](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/figure_9.png)
![Page 1](/figures/deep-unsupervised-learning-using-nonequilibrium-thermodynamics/page_1.png)

## Critical Analysis
**Novel Insight**: The central conceptual leap is to treat the probabilistic model not as a single intractable potential, but as the finite-time reversal of a deliberately chosen, slowly destructive forward diffusion. Because each small diffusion step is analytically tractable and its reverse has the same functional form, the full trajectory's probability can be evaluated cheaply, the model can be trained by regressing local perturbations, and conditioning only requires weighting each step by a slowly varying factor. This reframes generative modeling as learning to undo a thermodynamic arrow of time.

**Fundamental Limitations**: The lower bound K is only tight in the quasi-static limit of infinitesimal diffusion rate; practical finite-time chains yield a bound rather than exact likelihood. Gradient-based learning of the diffusion schedule is only straightforward for Gaussian diffusion; binomial diffusion uses a fixed annealing schedule due to discrete states. Likelihood comparisons on MNIST rely on Parzen-window estimates, and the entropy bounds require unit-variance data. Thousands of steps make sampling and training computationally heavy, and extension to high-resolution images is not demonstrated.

**Research Frontier**: This paper opens the diffusion probabilistic model line: subsequent work scales these models to high-resolution image synthesis, connects them to score matching and stochastic differential equations, improves noise schedules, and adds guidance and conditional generation. Its framework also invites theoretical analysis of forward/reverse processes, exact likelihood estimation via thermodynamic integration, and applications in inverse problems such as denoising, inpainting, and super-resolution.

## Relations
Written in a landscape dominated by variational autoencoders, GSNs, NADEs, and GANs, this paper deliberately borrows annealed importance sampling and Jarzynski's equality from nonequilibrium statistical physics rather than variational Bayesian inference. It positions itself as restoring the tractability-flexibility balance: unlike wake-sleep/variational methods, the inference process is fixed to the forward diffusion, enabling thousands of layers; unlike GSNs, probabilities can be evaluated and the model readily multiplied with conditioning distributions. The paper thereby supersedes the need for expensive MCMC normalization in a wide class of deep generative models and initiates the diffusion-based approach.

_No relations to existing wiki papers detected._

## Citations
_0 of 56 citations linked to compiled papers._

1. Barron, J. T., Biggin, M. D., Arbelaez, P., Knowles, D. W., Keranen, S. V., and Malik, J. Volumetric Semantic Segmentation Using Pyramid Context Features. In 2013 IEEE International Conference on Computer Vision, pp. 3448–3455. IEEE, December 2013. ISBN 978-1-4799-2840-8. doi: 10.1109/ICCV.2013.428.
2. Bengio, Y. and Thibodeau-Laufer, E. Deep generative stochastic networks trainable by backprop. arXiv preprint arXiv:1306.1091, 2013.
3. Bengio, Y., Mesnil, G., Dauphin, Y., and Rifai, S. Better Mixing via Deep Representations. arXiv preprint arXiv:1207.4404, July 2012.
4. Bergstra, J. and Breuleux, O. Theano: a CPU and GPU math expression compiler. Proceedings of the Python for Scientific Computing Conference (SciPy), 2010.
5. Besag, J. Statistical Analysis of Non-Lattice Data. The Statistician, 24(3), 179-195, 1975.
6. Bishop, C., Svensén, M., and Williams, C. GTM: The generative topographic mapping. Neural computation, 1998.
7. Bornschein, J. and Bengio, Y. Reweighted Wake-Sleep. International Conference on Learning Representations, June 2015.
8. Burda, Y., Grosse, R. B., and Salakhutdinov, R. Accurate and Conservative Estimates of MRF Log-likelihood using Reverse Annealing. arXiv:1412.8566, December 2014.
9. Dayan, P., Hinton, G. E., Neal, R. M., and Zemel, R. S. The helmholtz machine. Neural computation, 7(5):889–904, 1995.
10. Dinh, L., Krueger, D., and Bengio, Y. NICE: Non-linear Independent Components Estimation. arXiv:1410.8516, pp. 11, October 2014.
11. Feller, W. On the theory of stochastic processes, with particular reference to applications. In Proceedings of the [First] Berkeley Symposium on Mathematical Statistics and Probability. The Regents of the University of California, 1949.
12. Gershman, S. J. and Blei, D. M. A tutorial on Bayesian nonparametric models. Journal of Mathematical Psychology, 56(1):1–12, 2012.
13. Gneiting, T. and Raftery, A. E. Strictly proper scoring rules, prediction, and estimation. Journal of the American Statistical Association, 102(477):359–378, 2007.
14. Goodfellow, I. J., Pouget-Abadie, J., Mirza, M., Xu, B., Warde-Farley, D., Ozair, S., Courville, A., and Bengio, Y. Generative Adversarial Nets. Advances in Neural Information Processing Systems, 2014.
15. Gregor, K., Danihelka, I., Mnih, A., Blundell, C., and Wierstra, D. Deep AutoRegressive Networks. arXiv preprint arXiv:1310.8499, October 2013.
16. Grosse, R. B., Maddison, C. J., and Salakhutdinov, R. Annealing between distributions by averaging moments. In Advances in Neural Information Processing Systems, pp. 2769–2777, 2013.
17. Hinton, G. E. Training products of experts by minimizing contrastive divergence. Neural Computation, 14(8):1771–1800, 2002.
18. Hinton, G. E. The wake-sleep algorithm for unsupervised neural networks). Science, 1995.
19. Hyvärinen, A. Estimation of non-normalized statistical models using score matching. Journal of Machine Learning Research, 6:695–709, 2005.
20. Jarzynski, C. Equilibrium free-energy differences from nonequilibrium measurements: A master-equation approach. Physical Review E, January 1997.
21. Jarzynski, C. Equalities and inequalities: irreversibility and the second law of thermodynamics at the nanoscale. Annu. Rev. Condens. Matter Phys., 2011.
22. Jeulin, D. Dead leaves models: from space tesselation to random functions. Proc. of the Symposium on the Advances in the Theory and Applications of Random Sets, 1997.
23. Jordan, M. I., Ghahramani, Z., Jaakkola, T. S., and Saul, L. K. An introduction to variational methods for graphical models. Machine learning, 37(2):183–233, 1999.
24. Kavukcuoglu, K., Ranzato, M., and LeCun, Y. Fast inference in sparse coding algorithms with applications to object recognition. arXiv preprint arXiv:1010.3467, 2010.
25. Kingma, D. P. and Welling, M. Auto-Encoding Variational Bayes. International Conference on Learning Representations, December 2013.
26. Krizhevsky, A. and Hinton, G. Learning multiple layers of features from tiny images. Computer Science Department University of Toronto Tech. Rep., 2009.
27. Langevin, P. Sur la théorie du mouvement brownien. CR Acad. Sci. Paris, 146(530-533), 1908.
28. Larochelle, H. and Murray, I. The neural autoregressive distribution estimator. Journal of Machine Learning Research, 2011.
29. Lazebnik, S., Schmid, C., and Ponce, J. A sparse texture representation using local affine regions. Pattern Analysis and Machine Intelligence, IEEE Transactions on, 27(8):1265–1278, 2005.
30. LeCun, Y. and Cortes, C. The MNIST database of handwritten digits. 1998.
31. Lee, A., Mumford, D., and Huang, J. Occlusion models for natural images: A statistical study of a scale-invariant dead leaves model. International Journal of Computer Vision, 2001.
32. Lyu, S. Unifying Non-Maximum Likelihood Learning Objectives with Minimum KL Contraction. Advances in Neural Information Processing Systems 24, pp. 64–72, 2011.
33. MacKay, D. Bayesian neural networks and density networks. Nuclear Instruments and Methods in Physics Research Section A: Accelerators, Spectrometers, Detectors and Associated Equipment, 1995.
34. Murphy, K. P., Weiss, Y., and Jordan, M. I. Loopy belief propagation for approximate inference: An empirical study. In Proceedings of the Fifteenth conference on Uncertainty in artificial intelligence, pp. 467–475. Morgan Kaufmann Publishers Inc., 1999.
35. Neal, R. Annealed importance sampling. Statistics and Computing, January 2001.
36. Ozair, S. and Bengio, Y. Deep Directed Generative Autoencoders. arXiv:1410.0630, October 2014.
37. Parry, M., Dawid, A. P., Lauritzen, S., and Others. Proper local scoring rules. The Annals of Statistics, 40(1):561–592, 2012.
38. Rezende, D. J., Mohamed, S., and Wierstra, D. Stochastic Backpropagation and Approximate Inference in Deep Generative Models. Proceedings of the 31st International Conference on Machine Learning (ICML-14), January 2014.
39. Rippel, O. and Adams, R. P. High-Dimensional Probability Estimation with Deep Density Models. arXiv:1410.8516, pp. 12, February 2013.
40. Schmidhuber, J. Learning factorial codes by predictability minimization. Neural Computation, 1992.
41. Sminchisescu, C., Kanaujia, A., and Metaxas, D. Learning joint top-down and bottom-up processes for 3D visual inference. In Computer Vision and Pattern Recognition, 2006 IEEE Computer Society Conference on, volume 2, pp. 1743–1752. IEEE, 2006.
42. Sohl-Dickstein, J., Battaglino, P., and DeWeese, M. New Method for Parameter Estimation in Probabilistic Models: Minimum Probability Flow. Physical Review Letters, 107(22):11–14, November 2011a. ISSN 0031-9007. doi: 10.1103/PhysRevLett.107.220601.
43. Sohl-Dickstein, J., Battaglino, P. B., and DeWeese, M. R. Minimum Probability Flow Learning. International Conference on Machine Learning, 107(22):11–14, November 2011b. ISSN 0031-9007. doi: 10.1103/PhysRevLett.107.220601.
44. Sohl-Dickstein, J., Poole, B., and Ganguli, S. Fast large-scale optimization by unifying stochastic gradient and quasi-Newton methods. In Proceedings of the 31st International Conference on Machine Learning (ICML-14), pp. 604–612, 2014.
45. Spinney, R. and Ford, I. Fluctuation Relations : A Pedagogical Overview. arXiv preprint arXiv:1201.6381, pp. 3–56, 2013.
46. Stuhlmüller, A., Taylor, J., and Goodman, N. Learning stochastic inverses. Advances in Neural Information Processing Systems, 2013.
47. Suykens, J. and Vandewalle, J. Nonconvex optimization using a Fokker-Planck learning machine. In 12th European Conference on Circuit Theory and Design, 1995.
48. T, P. Convergence condition of the TAP equation for the infinite-ranged Ising spin glass model. J. Phys. A: Math. Gen. 15 1971, 1982.
49. Tanaka, T. Mean-field theory of Boltzmann machine learning. Physical Review Letters E, January 1998.
50. Theis, L., Hosseini, R., and Bethge, M. Mixtures of conditional Gaussian scale mixtures applied to multiscale image representations. PloS one, 7(7):e39857, 2012.
51. Theis, L., van den Oord, A., and Bethge, M. A note on the evaluation of generative models. arXiv preprint arXiv:1511.01844, 2015.
52. Uria, B., Murray, I., and Larochelle, H. RNADE: The real-valued neural autoregressive density-estimator. Advances in Neural Information Processing Systems, 2013a.
53. Uria, B., Murray, I., and Larochelle, H. A Deep and Tractable Density Estimator. arXiv:1310.1757, pp. 9, October 2013b.
54. van Merriënboer, B., Chorowski, J., Serdyuk, D., Bengio, Y., Bogdanov, D., Dumoulin, V., and Warde-Farley, D. Blocks and Fuel. Zenodo, May 2015. doi: 10.5281/zenodo.17721.
55. Welling, M. and Hinton, G. A new learning algorithm for mean field Boltzmann machines. Lecture Notes in Computer Science, January 2002.
56. Yao, L., Ozair, S., Cho, K., and Bengio, Y. On the Equivalence Between Deep NADE and Generative Stochastic Networks. In Machine Learning and Knowledge Discovery in Databases, pp. 322–336. Springer, 2014.
## Feeds
milestone: [[diffusion-probabilistic-models]]
