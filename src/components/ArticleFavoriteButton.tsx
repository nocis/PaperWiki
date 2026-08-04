"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ArticleFavoriteButton({
  slug,
  initialFavorite,
}: {
  slug: string;
  initialFavorite: boolean;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);

  // Re-sync when the server re-renders with a different value (router.refresh,
  // navigation, another tab) — local state must never outlive server truth.
  useEffect(() => {
    setFavorite(initialFavorite);
  }, [initialFavorite]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/knowledge/articles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, favorite: !favorite }),
      });
      if (!res.ok) return;
      setFavorite(!favorite);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      title={
        favorite
          ? "Favorited — archived, kept by the next knowledge compile"
          : "Mark as favorite — survives the next knowledge compile wipe"
      }
      className={`text-sm font-medium ${favorite ? "text-amber-600 hover:text-amber-700" : "text-gray-400 hover:text-amber-500"}`}
    >
      {favorite ? "★ Favorited" : "☆ Favorite"}
    </button>
  );
}
