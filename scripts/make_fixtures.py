#!/usr/bin/env python3
"""Generate 3 fixture PDFs into papers/new/ for end-to-end compile testing.

Usage:
  python3 -m venv /tmp/fixture-venv
  /tmp/fixture-venv/bin/pip install fpdf2
  /tmp/fixture-venv/bin/python scripts/make_fixtures.py

The three papers form a citation chain (BERT -> Attention; GPT-3 -> both),
which exercises topic creation, multi-source synthesis, chronological
evolution, and reference resolution in one compile run.

Two files use real arXiv-style names (1706.03762.pdf, 2005.14165.pdf) to
exercise title-based renaming; one uses a descriptive filename.
ASCII-only text (core PDF fonts are latin-1).
"""
import os
from fpdf import FPDF

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "papers", "new")

PAPERS = [
    {
        "file": "1706.03762.pdf",
        "title": "Attention Is All You Need",
        "authors": "Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin",
        "venue": "NeurIPS 2017",
        "sections": [
            ("Abstract",
             "The dominant sequence transduction models are based on complex recurrent or "
             "convolutional neural networks that include an encoder and a decoder. The best "
             "performing models also connect the encoder and decoder through an attention "
             "mechanism. We propose a new simple network architecture, the Transformer, "
             "based solely on attention mechanisms, dispensing with recurrence and convolutions "
             "entirely. Experiments on two machine translation tasks show these models to be "
             "superior in quality while being more parallelizable and requiring significantly "
             "less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German "
             "translation task, improving over the existing best results, including ensembles, "
             "by over 2 BLEU."),
            ("1 Introduction",
             "Recurrent neural networks, long short-term memory and gated recurrent neural "
             "networks in particular, have been firmly established as state of the art approaches "
             "in sequence modeling and transduction problems such as language modeling and "
             "machine translation. Numerous efforts have since continued to push the boundaries "
             "of recurrent language models and encoder-decoder architectures. Recurrent models "
             "typically factor computation along the symbol positions of the input and output "
             "sequences. This inherently sequential nature precludes parallelization within "
             "training examples, which becomes critical at longer sequence lengths, as memory "
             "constraints limit batching across examples."),
            ("3 Model Architecture",
             "The Transformer follows this overall architecture using stacked self-attention and "
             "point-wise, fully connected layers for both the encoder and decoder. The encoder is "
             "composed of a stack of N = 6 identical layers. Each layer has two sub-layers. The "
             "first is a multi-head self-attention mechanism, and the second is a simple, "
             "position-wise fully connected feed-forward network. We employ a residual connection "
             "around each of the two sub-layers, followed by layer normalization."),
            ("References",
             "[1] Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio. Neural machine translation "
             "by jointly learning to align and translate. ICLR, 2015.\n"
             "[2] Jonas Gehring, Michael Auli, David Grangier, Denis Yarats, and Yann N. Dauphin. "
             "Convolutional sequence to sequence learning. ICML, 2017.\n"
             "[3] Nal Kalchbrenner, Lasse Espeholt, Karen Simonyan, Aaron van den Oord, Alex "
             "Graves, and Koray Kavukcuoglu. Neural machine translation in linear time. arXiv "
             "preprint arXiv:1610.10099, 2016."),
        ],
    },
    {
        "file": "bert-pretraining-of-deep-bidirectional-transformers.pdf",
        "title": "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        "authors": "Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova",
        "venue": "NAACL 2019",
        "sections": [
            ("Abstract",
             "We introduce a new language representation model called BERT, which stands for "
             "Bidirectional Encoder Representations from Transformers. Unlike recent language "
             "representation models, BERT is designed to pre-train deep bidirectional "
             "representations from unlabeled text by jointly conditioning on both left and "
             "right context in all layers. As a result, the pre-trained BERT model can be "
             "fine-tuned with just one additional output layer to create state-of-the-art models "
             "for a wide range of tasks, such as question answering and language inference, "
             "without substantial task-specific architecture modifications. BERT obtains new "
             "state-of-the-art results on eleven natural language processing tasks, including "
             "pushing the GLUE score to 80.5."),
            ("1 Introduction",
             "Language model pre-training has been shown to be effective for improving many "
             "natural language processing tasks. There are two existing strategies for applying "
             "pre-trained language representations to downstream tasks: feature-based and "
             "fine-tuning. The feature-based approach, such as ELMo, uses task-specific "
             "architectures that include the pre-trained representations as additional features. "
             "The fine-tuning approach, such as the Generative Pre-trained Transformer (OpenAI "
             "GPT), introduces minimal task-specific parameters, and is trained on the downstream "
             "tasks by simply fine-tuning all pre-trained parameters."),
            ("3 BERT",
             "There are two steps in our framework: pre-training and fine-tuning. During "
             "pre-training, the model is trained on unlabeled data over different pre-training "
             "tasks. For fine-tuning, the BERT model is first initialized with the pre-trained "
             "parameters, and all of the parameters are fine-tuned using labeled data from the "
             "downstream tasks. A distinctive feature of BERT is its unified architecture across "
             "different tasks. We use the Transformer encoder architecture, following Attention "
             "Is All You Need. BERT is pre-trained with two unsupervised tasks: Masked Language "
             "Model (MLM) and Next Sentence Prediction (NSP)."),
            ("References",
             "[1] Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan "
             "N. Gomez, Lukasz Kaiser, and Illia Polosukhin. Attention is all you need. NeurIPS, "
             "2017.\n"
             "[2] Alec Radford, Karthik Narasimhan, Tim Salimans, and Ilya Sutskever. Improving "
             "language understanding by generative pre-training. OpenAI technical report, 2018.\n"
             "[3] Matthew E. Peters, Mark Neumann, Mohit Iyyer, Matt Gardner, Christopher Clark, "
             "Kenton Lee, and Luke Zettlemoyer. Deep contextualized word representations. NAACL, "
             "2018."),
        ],
    },
    {
        "file": "2005.14165.pdf",
        "title": "Language Models are Few-Shot Learners",
        "authors": "Tom B. Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared Kaplan, Prafulla Dhariwal, et al.",
        "venue": "NeurIPS 2020",
        "sections": [
            ("Abstract",
             "Recent work has demonstrated substantial gains on many NLP tasks and benchmarks by "
             "pre-training on a large corpus of text followed by fine-tuning on a specific task. "
             "While typically task-agnostic in architecture, this method still requires "
             "task-specific fine-tuning datasets of thousands or tens of thousands of examples. "
             "By contrast, humans can generally perform a new language task from only a few "
             "examples or from simple instructions - something which current NLP systems still "
             "largely struggle to do. Here we show that scaling up language models greatly "
             "improves task-agnostic, few-shot performance, sometimes even reaching "
             "competitiveness with prior state-of-the-art fine-tuning approaches. Specifically, "
             "we train GPT-3, an autoregressive language model with 175 billion parameters, and "
             "test its performance in the few-shot setting."),
            ("1 Introduction",
             "For GPT-3, we use the same model and architecture as GPT-2, including the modified "
             "initialization, pre-normalization, and reversible tokenization described therein, "
             "with the exception that we use alternating dense and locally banded sparse attention "
             "patterns in the layers of the transformer, similar to the Sparse Transformer. The "
             "model is trained on a filtered Common Crawl dataset, WebText2, Books1, Books2 and "
             "Wikipedia."),
            ("2 Approach",
             "Our basic pre-training approach, including model, data, and training, is similar to "
             "the process described in GPT-2, with relatively straightforward scaling up of the "
             "model size, dataset size and diversity, and length of training. Our use of in-context "
             "learning builds on a long tradition of work on meta-learning, and more recent work "
             "on few-shot learning through language model conditioning."),
            ("References",
             "[1] Ashish Vaswani, Noam Shazeer, Niki Parmar, et al. Attention is all you need. "
             "NeurIPS, 2017.\n"
             "[2] Jacob Devlin, Ming-Wei Chang, Kenton Lee, and Kristina Toutanova. BERT: "
             "Pre-training of deep bidirectional transformers for language understanding. NAACL, "
             "2019.\n"
             "[3] Alec Radford, Jeffrey Wu, Rewon Child, David Luan, Dario Amodei, and Ilya "
             "Sutskever. Language models are unsupervised multitask learners. OpenAI technical "
             "report, 2019."),
        ],
    },
]


def build_pdf(paper: dict) -> None:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("helvetica", "B", 16)
    pdf.multi_cell(0, 8, paper["title"])
    pdf.ln(2)
    pdf.set_font("helvetica", "I", 10)
    pdf.multi_cell(0, 5, paper["authors"])
    pdf.multi_cell(0, 5, paper["venue"])
    pdf.ln(4)
    for heading, body in paper["sections"]:
        pdf.set_font("helvetica", "B", 12)
        pdf.multi_cell(0, 6, heading)
        pdf.set_font("helvetica", "", 10)
        pdf.multi_cell(0, 5, body)
        pdf.ln(3)
    path = os.path.join(OUT, paper["file"])
    pdf.output(path)
    print(f"wrote {path}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for p in PAPERS:
        build_pdf(p)
