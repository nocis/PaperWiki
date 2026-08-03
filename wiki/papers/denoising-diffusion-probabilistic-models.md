---
slug: denoising-diffusion-probabilistic-models
title: Denoising Diffusion Probabilistic Models
authors:
  - Jonathan Ho
  - Ajay Jain
  - Pieter Abbeel
venue: NeurIPS 2020
publishedAt: 2020-12
tags:
  - year/2020-12
  - venue/NeurIPS-2020
milestone: diffusion-probabilistic-models
subtopic: null
numPages: 25
addedAt: '2026-08-03'
rawPath: papers/compiled/denoising-diffusion-probabilistic-models.pdf
pdfUrl: /pdfs/denoising-diffusion-probabilistic-models.pdf
cites: []
citedBy:
  - denoising-diffusion-implicit-models
---
## Essence
This paper establishes denoising diffusion probabilistic models as a high-quality image generative model class. It reparameterizes the reverse Markov chain to predict noise rather than the posterior mean, links training to denoising score matching and sampling to annealed Langevin dynamics, and introduces a simplified weighted variational objective. The models achieve state-of-the-art CIFAR10 FID 3.17 and reveal progressive lossy compression behavior.

## Contributions
- Shows diffusion models can generate high-quality images, with CIFAR10 FID 3.17/IS 9.46 and LSUN samples comparable to ProgressiveGAN, overturning the notion that they underperform.
- Introduces an epsilon-prediction reparameterization of the reverse process mean, revealing an equivalence with denoising score matching over multiple noise scales.
- Proposes a simplified weighted variational objective L_simple that discards the per-term weighting, yielding better sample quality than the true variational bound.
- Fixes forward process variances as constants and uses a U-Net backbone with shared sinusoidal time embeddings, enabling simple and stable training.
- Interprets diffusion sampling as progressive lossy decompression, showing most bits describe imperceptible details and connecting to autoregressive decoding with a generalized bit ordering.
- Ablations show epsilon prediction with the simplified objective outperforms mu prediction and learned variance parameterizations, guiding practical model design.

## Critical Analysis
**Novel Insight**: Diffusion models are not merely a restricted latent-variable model class; their training objective can be exactly reorganized into a denoising score matching form, and their sampling chain behaves like annealed Langevin dynamics. The epsilon-prediction parameterization turns the variational bound into a noise-prediction MSE that down-weights easy small-t denoising terms, making the model focus on harder large-scale structure. This same formulation exposes diffusion as an autoregressive-like progressive code where coarse image features are transmitted first and imperceptible detail last.

**Fundamental Limitations**: The models do not achieve competitive negative log-likelihoods compared to other likelihood-based models, despite high sample quality; the authors attribute this to an inductive bias toward lossy compression. Training and sampling require thousands of neural network evaluations (T=1000), making inference expensive. Learned reverse-process variances caused unstable training and worse samples, so the paper does not solve adaptive variance learning. The decoder is an independent discrete Gaussian rather than a more powerful conditional autoregressive decoder, which the authors leave to future work.

**Research Frontier**: This work opens diffusion models as a viable class for high-fidelity generation and connects them to score-based generative modeling, energy-based models, and autoregressive decoding. Subsequent research can extend diffusion models to other data modalities, develop faster sampling with shorter or learned diffusion processes, incorporate more expressive decoders, and combine diffusion components into larger generative systems. The progressive lossy compression view also suggests new designs for hierarchical and subscale generative models.

## Relations
Positioned in a field dominated by GANs, autoregressive models, flows, VAEs, and score matching, this paper revitalizes the nonequilibrium-thermodynamics diffusion models of Sohl-Dickstein et al. (2015). It supersedes the earlier belief that diffusion models cannot produce competitive samples, and it contradicts the sharp separation between score-based methods and variational training by showing denoising score matching is equivalent to a weighted variational bound for a Langevin-like sampler. Its progressive decoding view generalizes autoregressive ordering and places diffusion as a lossy compressor, complementing and partly unifying several existing generative-model lines.

_No relations to existing wiki papers detected._

## References
1. Guillaume Alain, Yoshua Bengio, Li Yao, Jason Yosinski, Eric Thibodeau-Laufer, Saizheng Zhang, and Pascal Vincent. GSNs: generative stochastic networks. Information and Inference: A Journal of the IMA, 5(2):210–249, 2016.
2. Florian Bordes, Sina Honari, and Pascal Vincent. Learning to generate samples from noise through infusion training. In International Conference on Learning Representations, 2017.
3. Andrew Brock, Jeff Donahue, and Karen Simonyan. Large scale GAN training for high fidelity natural image synthesis. In International Conference on Learning Representations, 2019.
4. Laurent Dinh, David Krueger, and Yoshua Bengio. NICE: Non-linear independent components estimation. arXiv preprint arXiv:1410.8516, 2014.
5. Laurent Dinh, Jascha Sohl-Dickstein, and Samy Bengio. Density estimation using Real NVP. arXiv preprint arXiv:1605.08803, 2016.
6. Yilun Du and Igor Mordatch. Implicit generation and modeling with energy based models. In Advances in Neural Information Processing Systems, pages 3603–3613, 2019.
7. Ian Goodfellow, Jean Pouget-Abadie, Mehdi Mirza, Bing Xu, David Warde-Farley, Sherjil Ozair, Aaron Courville, and Yoshua Bengio. Generative adversarial nets. In Advances in Neural Information Processing Systems, pages 2672–2680, 2014.
8. Karol Gregor, Frederic Besse, Danilo Jimenez Rezende, Ivo Danihelka, and Daan Wierstra. Towards conceptual compression. In Advances In Neural Information Processing Systems, pages 3549–3557, 2016.
9. Tero Karras, Timo Aila, Samuli Laine, and Jaakko Lehtinen. Progressive growing of GANs for improved quality, stability, and variation. In International Conference on Learning Representations, 2018.
10. Diederik P Kingma and Max Welling. Auto-encoding variational Bayes. arXiv preprint arXiv:1312.6114, 2013.
11. Diederik P Kingma, Tim Salimans, Rafal Jozefowicz, Xi Chen, Ilya Sutskever, and Max Welling. Improved variational inference with inverse autoregressive flow. In Advances in Neural Information Processing Systems, pages 4743–4751, 2016.
12. Jacob Menick and Nal Kalchbrenner. Generating high fidelity images with subscale pixel networks and multidimensional upscaling. In International Conference on Learning Representations, 2019.
13. Olaf Ronneberger, Philipp Fischer, and Thomas Brox. U-Net: Convolutional networks for biomedical image segmentation. In International Conference on Medical Image Computing and Computer-Assisted Intervention, pages 234–241. Springer, 2015.
14. Tim Salimans, Andrej Karpathy, Xi Chen, and Diederik P Kingma. PixelCNN++: Improving the PixelCNN with discretized logistic mixture likelihood and other modifications. In International Conference on Learning Representations, 2017.
15. Jascha Sohl-Dickstein, Eric Weiss, Niru Maheswaranathan, and Surya Ganguli. Deep unsupervised learning using nonequilibrium thermodynamics. In International Conference on Machine Learning, pages 2256–2265, 2015.
16. Yang Song and Stefano Ermon. Generative modeling by estimating gradients of the data distribution. In Advances in Neural Information Processing Systems, pages 11895–11907, 2019.
17. Yang Song and Stefano Ermon. Improved techniques for training score-based generative models. arXiv preprint arXiv:2006.09011, 2020.
18. Aaron van den Oord, Sander Dieleman, Heiga Zen, Karen Simonyan, Oriol Vinyals, Alex Graves, Nal Kalchbrenner, Andrew Senior, and Koray Kavukcuoglu. WaveNet: A generative model for raw audio. arXiv preprint arXiv:1609.03499, 2016.
19. Aaron van den Oord, Nal Kalchbrenner, and Koray Kavukcuoglu. Pixel recurrent neural networks. International Conference on Machine Learning, 2016.
20. Aaron van den Oord, Nal Kalchbrenner, Oriol Vinyals, Lasse Espeholt, Alex Graves, and Koray Kavukcuoglu. Conditional image generation with PixelCNN decoders. In Advances in Neural Information Processing Systems, pages 4790–4798, 2016.
21. Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Łukasz Kaiser, and Illia Polosukhin. Attention is all you need. In Advances in Neural Information Processing Systems, pages 5998–6008, 2017.
22. Pascal Vincent. A connection between score matching and denoising autoencoders. Neural Computation, 23(7):1661–1674, 2011.
23. Yuxin Wu and Kaiming He. Group normalization. In Proceedings of the European Conference on Computer Vision (ECCV), pages 3–19, 2018.
24. Fisher Yu, Yinda Zhang, Shuran Song, Ari Seff, and Jianxiong Xiao. LSUN: Construction of a large-scale image dataset using deep learning with humans in the loop. arXiv preprint arXiv:1506.03365, 2015.

## Feeds
milestone: [[diffusion-probabilistic-models]]
