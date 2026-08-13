/**
 * Topic checks: paper milestone/subtopic validity, the topic hierarchy
 * (parents, children, depth), granularity/hollow topics, and tag-to-parent.
 */
import { depthOf, emit, queueProposal, topicBySlug } from "./state";
import type { LintIssue, LintRule, LintState } from "./types";

/** Paper → topic references: orphan papers and unknown subtopics. */
export const checkMilestoneValidity: LintRule = {
  id: "milestone-validity",
  async run(state: LintState) {
    for (const paper of state.ctx.paperPages) {
      const topic = topicBySlug(state.ctx.topicPages, paper.fm.milestone);
      if (!topic) {
        await emit(state, {
          severity: "error",
          kind: "orphan-paper",
          target: paper.fm.slug,
          message: `milestone "${paper.fm.milestone}" is not a topic`,
          autoFixable: false,
        });
      } else if (paper.fm.subtopic && !(topic.fm.subtopics ?? []).includes(paper.fm.subtopic)) {
        await emit(state, {
          severity: "error",
          kind: "unknown-subtopic",
          target: paper.fm.slug,
          message: `claims subtopic "${paper.fm.subtopic}" not listed in topic "${topic.fm.slug}"`,
          autoFixable: false,
        });
      }
    }
  },
};

/** Topic hierarchy: parents/children reciprocity and max depth. */
export const checkTopicHierarchy: LintRule = {
  id: "topic-hierarchy",
  async run(state: LintState) {
    for (const topic of state.ctx.topicPages) {
      if (topic.fm.parent_milestone) {
        const parent = topicBySlug(state.ctx.topicPages, topic.fm.parent_milestone);
        if (!parent) {
          await emit(state, {
            severity: "error",
            kind: "unknown-parent",
            target: topic.fm.slug,
            message: `parent_milestone "${topic.fm.parent_milestone}" does not exist`,
            autoFixable: false,
          });
        } else if (!parent.fm.children.includes(topic.fm.slug)) {
          await emit(state, {
            severity: "error",
            kind: "parent-children-mismatch",
            target: topic.fm.slug,
            message: `parent "${parent.fm.slug}" does not list it in children[]`,
            autoFixable: false,
          });
        }
      }
      for (const child of topic.fm.children) {
        const childPage = topicBySlug(state.ctx.topicPages, child);
        if (!childPage) {
          await emit(state, {
            severity: "error",
            kind: "unknown-child",
            target: topic.fm.slug,
            message: `lists child "${child}" which does not exist`,
            autoFixable: false,
          });
        } else if (childPage.fm.parent_milestone !== topic.fm.slug) {
          await emit(state, {
            severity: "error",
            kind: "child-parent-mismatch",
            target: topic.fm.slug,
            message: `child "${child}" has parent_milestone "${childPage.fm.parent_milestone}"`,
            autoFixable: false,
          });
        }
      }
      if (depthOf(topic.fm.slug, state.ctx.topicPages) > 3) {
        await emit(state, {
          severity: "error",
          kind: "depth-overflow",
          target: topic.fm.slug,
          message: "exceeds max topic depth 3",
          autoFixable: false,
        });
      }
    }
  },
};

/** Hollow / granularity (Confirm-tier proposals). */
export const checkGranularity: LintRule = {
  id: "granularity",
  async run(state: LintState) {
    const topicCounts = new Map<string, number>();
    for (const paper of state.ctx.paperPages) {
      topicCounts.set(paper.fm.milestone, (topicCounts.get(paper.fm.milestone) ?? 0) + 1);
    }

    for (const topic of state.ctx.topicPages) {
      const count = topicCounts.get(topic.fm.slug) ?? 0;
      if (topic.fm.mode === "standalone" && count > 8) {
        await emit(state, {
          severity: "warning",
          kind: "granularity",
          target: topic.fm.slug,
          message: `${count} sources > 8 — candidate for split-topic`,
          autoFixable: false,
        });
        await queueProposal("split-topic", topic.fm.slug, null, `${count} sources > 8 — topic is too coarse; identify sub-clusters`);
      }
      if (topic.fm.mode === "merged") {
        for (const sub of topic.fm.subtopics) {
          const subCount = state.ctx.paperPages.filter((p) => p.fm.milestone === topic.fm.slug && p.fm.subtopic === sub).length;
          if (subCount >= 5) {
            await emit(state, {
              severity: "warning",
              kind: "granularity",
              target: topic.fm.slug,
              message: `subtopic "${sub}" has ${subCount} papers >= 5 — candidate for promote-subtopic`,
              autoFixable: false,
            });
            await queueProposal("promote-subtopic", topic.fm.slug, sub, `${subCount} papers >= 5 — split out to topics/${topic.fm.slug}/${sub}.md`);
          }
        }
      }
      if (count === 0 && topic.fm.children.length === 0) {
        await emit(state, {
          severity: "warning",
          kind: "hollow-topic",
          target: topic.fm.slug,
          message: "topic has no sources and no children",
          autoFixable: false,
        });
      }
      // A topic with sources but an empty body is a skeleton left by an
      // interrupted run (the paper was written, synthesis never completed) —
      // visible damage must not pass silently.
      if (count > 0 && !topic.body.trim()) {
        await emit(state, {
          severity: "warning",
          kind: "hollow-topic",
          target: topic.fm.slug,
          message: `topic page body is empty (${count} source${count === 1 ? "" : "s"}) — synthesis was interrupted; recompile to restore`,
          autoFixable: false,
        });
      }
    }
  },
};

/** Tag-to-parent: 3+ root standalone topics sharing a tag. */
export const checkTagToParent: LintRule = {
  id: "tag-to-parent",
  async run(state: LintState) {
    const roots = state.ctx.topicPages.filter((t) => !t.fm.parent_milestone && t.fm.mode === "standalone");
    const byTag = new Map<string, string[]>();
    for (const t of roots) {
      for (const tag of t.fm.tags ?? []) {
        byTag.set(tag, [...(byTag.get(tag) ?? []), t.fm.slug]);
      }
    }
    for (const [tag, slugs] of byTag) {
      if (slugs.length >= 3) {
        await emit(state, {
          severity: "warning",
          kind: "tag-to-parent",
          target: tag,
          message: `${slugs.length} standalone topics share tag "${tag}" (${slugs.join(", ")})`,
          autoFixable: false,
        });
        await queueProposal("tag-to-parent", tag, null, `${slugs.length} standalone topics share tag "${tag}" (${slugs.join(", ")}) — consider a merged parent`);
      }
    }
  },
};
