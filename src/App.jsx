import React, { useEffect, useMemo, useRef, useState } from "react";

// Taylor's Recipe Ideas — single-file React app with TailwindCSS styling
// Uses TheMealDB public API: filter by ingredient + lookup by id
// Key features: 4-section layout (Top, Left, Center, Right), multi-ingredient search with autosuggest,
// filters, results grid, and details panel.

// ----------------------------- Helpers -----------------------------
const API = {
  filterByIngredient: (ing) =>
    fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ing)}`).then((r) => r.json()),
  lookupById: (id) =>
    fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`).then((r) => r.json()),
  listIngredients: () =>
    fetch("https://www.themealdb.com/api/json/v1/1/list.php?i=list").then((r) => r.json()),
};

function classNames(...c) {
  return c.filter(Boolean).join(" ");
}

function useDebouncedValue(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// Very light heuristic for time estimation when API lacks a duration
function estimateCookTime(meal) {
  // Estimate by number of ingredients + instruction length
  const ings = extractIngredients(meal);
  const base = 10;
  const byIngs = ings.length * 2; // ~2 mins per ingredient
  const bySteps = (meal?.strInstructions || "").split(/\n|\.|\r/).filter((s) => s.trim().length > 6).length * 2;
  const total = Math.min(120, Math.round(base + byIngs + bySteps));
  return total; // minutes
}

function extractIngredients(meal) {
  if (!meal) return [];
  const pairs = [];
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ing && ing.trim()) {
      pairs.push({ ingredient: ing.trim(), measure: (measure || "").trim() });
    }
  }
  return pairs;
}

function formatMinutes(mins) {
  if (!mins || isNaN(mins)) return "—";
  if (mins > 60) return "> 1 hr";
  if (mins === 60) return "1 hr";
  if (mins >= 50) return "50–60 mins";
  if (mins >= 40) return "40–50 mins";
  if (mins >= 30) return "30–40 mins";
  if (mins >= 20) return "20–30 mins";
  if (mins >= 10) return "10–20 mins";
  return "< 10 mins";
}

// ----------------------------- Main App -----------------------------
export default function App() {
  // Theme
  const [theme, setTheme] = useState(() => (typeof window !== "undefined" && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light"));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  // Profile dropdown hover
  const [showProfile, setShowProfile] = useState(false);

  // Left filters
  const [cuisines, setCuisines] = useState([]); // selected cuisines
  const cuisineOptions = [
    { label: "North Indian", value: "Indian" },
    { label: "South Indian", value: "Indian" },
    { label: "Chinese", value: "Chinese" },
    { label: "Americans", value: "American" },
    { label: "Russians", value: "Russian" },
  ];
  const [cookTime, setCookTime] = useState(45); // minutes slider
  const [mealTimes, setMealTimes] = useState([]); // Breakfast, Lunch, Snack, Dinner (decorative filter)
  const [diet, setDiet] = useState([]); // Veg, Non-Veg, Sea-food, Drinks

  // Center search state
  const [allIngredients, setAllIngredients] = useState([]);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 150);
  const [selectedIngredients, setSelectedIngredients] = useState([]);

  // Results + selection
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meals, setMeals] = useState([]); // list of detailed meal objects
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [favourites, setFavourites] = useState([]);

  // Load ingredients list once
  useEffect(() => {
    API.listIngredients()
      .then((d) => {
        const names = (d?.meals || [])
          .map((x) => x?.strIngredient)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setAllIngredients(names);
      })
      .catch(() => setAllIngredients([]));
  }, []);

  // Autosuggest list from query
  const suggestions = useMemo(() => {
    if (!debouncedQuery) return [];
    const q = debouncedQuery.toLowerCase();
    return allIngredients
      .filter((n) => n.toLowerCase().includes(q) && !selectedIngredients.includes(n))
      .slice(0, 10);
  }, [debouncedQuery, allIngredients, selectedIngredients]);

  // Fetch meals when ingredients change
  useEffect(() => {
    const run = async () => {
      setError("");
      setMeals([]);
      setSelectedMeal(null);
      if (selectedIngredients.length === 0) return;
      setLoading(true);
      try {
        // For each ingredient, fetch list of meals; then intersect by id
        const lists = await Promise.all(
          selectedIngredients.map((ing) => API.filterByIngredient(ing))
        );
        const mealSets = lists.map((d) => new Set((d?.meals || []).map((m) => m.idMeal)));
        // Intersect IDs
        let intersection = null;
        for (const s of mealSets) {
          if (!intersection) intersection = new Set(s);
          else intersection = new Set([...intersection].filter((x) => s.has(x)));
        }
        const ids = [...(intersection || [])].slice(0, 20); // limit
        // Lookup details
        const details = await Promise.all(
          ids.map(async (id) => {
            const d = await API.lookupById(id);
            return d?.meals?.[0];
          })
        );
        const clean = details.filter(Boolean);
        // Apply filters (cuisine, cook time, diet)
        const filtered = clean.filter((meal) => {
          const minutes = estimateCookTime(meal);
          // Cuisine check — compare strArea & strCategory loosely
          const area = (meal.strArea || "").toLowerCase();
          const category = (meal.strCategory || "").toLowerCase();
          const cuisineOk =
            cuisines.length === 0 ||
            cuisines.some((c) => area.includes(c.value.toLowerCase()) || category.includes(c.value.toLowerCase()));

          const timeOk = minutes <= cookTime || cookTime >= 70; // 70+ represents more than an hour

          const ings = extractIngredients(meal).map((x) => x.ingredient.toLowerCase());
          const isVeg = !/(chicken|beef|pork|mutton|lamb|bacon|fish|shrimp|prawn|crab|clam|oyster|tuna|salmon)/i.test(
            ings.join(" ")
          );
          const isSea = /(fish|shrimp|prawn|crab|clam|oyster|tuna|salmon)/i.test(ings.join(" ")) || category.includes("seafood");
          const isDrink = /drink|beverage|shake|smoothie|cocktail|juice/i.test(
            `${category} ${meal.strMeal}`
          );

          const dietOk =
            diet.length === 0 ||
            diet.some((d) =>
              (d === "Veg" && isVeg) ||
              (d === "Non-Veg" && !isVeg && !isDrink) ||
              (d === "Sea-food" && isSea) ||
              (d === "Drinks" && isDrink)
            );

          // Meal time (best-effort: look for keywords)
          const mealTimeOk =
            mealTimes.length === 0 ||
            mealTimes.some((t) => new RegExp(t, "i").test(meal.strMeal) || new RegExp(t, "i").test(meal.strTags || ""));

          return cuisineOk && timeOk && dietOk && mealTimeOk;
        });

        setMeals(filtered);
        setSelectedMeal(filtered[0] || null);
      } catch (e) {
        console.error(e);
        setError("Could not load recipes. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [selectedIngredients, cuisines, cookTime, diet, mealTimes]);

  const addIngredient = (name) => {
    if (!name) return;
    if (selectedIngredients.includes(name)) return;
    setSelectedIngredients((s) => [...s, name]);
    setQuery("");
  };
  const removeIngredient = (name) => setSelectedIngredients((s) => s.filter((x) => x !== name));

  const toggleFavourite = (meal) => {
    setFavourites((f) => {
      const exists = f.find((x) => x.idMeal === meal.idMeal);
      if (exists) return f.filter((x) => x.idMeal !== meal.idMeal);
      return [...f, { idMeal: meal.idMeal, strMeal: meal.strMeal }];
    });
  };

  // ----------------------------- UI -----------------------------
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* Left: Logo */}
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-white select-none shadow">
              RI
            </div>
          </div>

          {/* Center: Title */}
          <h1 className="text-xl sm:text-2xl font-semibold tracking-wide">Recipe Ideas</h1>

          {/* Right: Profile with hover dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setShowProfile(true)}
            onMouseLeave={() => setShowProfile(false)}
          >
            <div className="flex items-center gap-3 cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 grid place-items-center font-bold text-white">
                T
              </div>
              <span className="hidden sm:inline-block">Taylor</span>
            </div>
            {showProfile && (
              <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl p-2">
                <div className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">Logged in as <b>Taylor</b></div>
                <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => alert(JSON.stringify(favourites, null, 2))}>Favourites</button>
                <div className="px-3 py-2 flex items-center justify-between">
                  <span>Themes</span>
                  <div className="flex gap-1">
                    <button
                      className={classNames("px-2 py-1 rounded-lg border text-xs", theme === "light" ? "bg-gray-100 dark:bg-gray-800" : "")}
                      onClick={() => setTheme("light")}
                    >Light</button>
                    <button
                      className={classNames("px-2 py-1 rounded-lg border text-xs", theme === "dark" ? "bg-gray-100 dark:bg-gray-800" : "")}
                      onClick={() => setTheme("dark")}
                    >Dark</button>
                  </div>
                </div>
                <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600" onClick={() => alert("Logged out")}>Logout</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid: Left | Center | Right */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        {/* Left: Filters */}
        <aside className="lg:col-span-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 h-max sticky top-20">
          <h2 className="text-lg font-semibold mb-3">Filters</h2>

          {/* Cuisine */}
          <section className="mb-5">
            <h3 className="font-medium mb-2">Cuisine Type</h3>
            <div className="space-y-2">
              {cuisineOptions.map((opt) => (
                <label key={opt.label} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-emerald-600"
                    checked={!!cuisines.find((c) => c.label === opt.label)}
                    onChange={(e) => {
                      setCuisines((prev) =>
                        e.target.checked ? [...prev, opt] : prev.filter((c) => c.label !== opt.label)
                      );
                    }}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Cooking time */}
          <section className="mb-5">
            <h3 className="font-medium mb-2">Cooking time</h3>
            <input
              type="range"
              min={10}
              max={90} // 70+ means more than an hour for our UI
              value={cookTime}
              step={5}
              onChange={(e) => setCookTime(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Up to: <b>{cookTime >= 70 ? "> 1 hr" : `${cookTime} mins`}</b></div>
          </section>

          {/* Meal Time */}
          <section className="mb-5">
            <h3 className="font-medium mb-2">Meal Time</h3>
            <div className="flex flex-wrap gap-2">
              {["Breakfast", "Lunch", "Snack", "Dinner"].map((m) => {
                const active = mealTimes.includes(m);
                return (
                  <button
                    key={m}
                    onClick={() =>
                      setMealTimes((prev) => (active ? prev.filter((x) => x !== m) : [...prev, m]))
                    }
                    className={classNames(
                      "px-3 py-1 rounded-full border text-sm",
                      active ? "bg-emerald-500 text-white border-emerald-500" : "hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Diet Preference */}
          <section>
            <h3 className="font-medium mb-2">Diet Preference</h3>
            <div className="flex flex-wrap gap-2">
              {["Veg", "Non-Veg", "Sea-food", "Drinks"].map((m) => {
                const active = diet.includes(m);
                return (
                  <button
                    key={m}
                    onClick={() => setDiet((prev) => (active ? prev.filter((x) => x !== m) : [...prev, m]))}
                    className={classNames(
                      "px-3 py-1 rounded-full border text-sm",
                      active ? "bg-indigo-500 text-white border-indigo-500" : "hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        {/* Center: Search + Results */}
        <main className="lg:col-span-6 space-y-4">
          {/* Search Bar with autosuggest and chips */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              {selectedIngredients.map((ing) => (
                <span key={ing} className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 text-sm flex items-center gap-2">
                  {ing}
                  <button onClick={() => removeIngredient(ing)} className="text-xs hover:opacity-75">✕</button>
                </span>
              ))}
            </div>

            <div className="relative">
              <input
                placeholder="Search ingredients… (e.g., chicken, tomato)"
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim()) addIngredient(query.trim());
                }}
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg max-h-64 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => addIngredient(s)}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-2">Tip: Add multiple ingredients and we’ll find recipes containing all of them.</div>
          </div>

          {/* Results grid */}
          <div className="min-h-[12rem]">
            {loading && (
              <div className="grid place-items-center h-48 text-gray-500">Loading recipes…</div>
            )}
            {!loading && error && (
              <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-200">{error}</div>
            )}
            {!loading && !error && meals.length === 0 && selectedIngredients.length > 0 && (
              <div className="p-4 rounded-xl bg-yellow-50 text-yellow-800 border border-yellow-200">No results matched your filters.</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {meals.map((meal) => {
                const minutes = estimateCookTime(meal);
                return (
                  <article
                    key={meal.idMeal}
                    onClick={() => setSelectedMeal(meal)}
                    className={classNames(
                      "cursor-pointer bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden hover:shadow-md transition",
                      selectedMeal?.idMeal === meal.idMeal ? "ring-2 ring-emerald-500" : ""
                    )}
                  >
                    <img src={meal.strMealThumb} alt={meal.strMeal} className="w-full aspect-video object-cover" />
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold line-clamp-1" title={meal.strMeal}>{meal.strMeal}</h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavourite(meal);
                          }}
                          className="text-xl"
                          title="Toggle Favourite"
                        >
                          {favourites.find((f) => f.idMeal === meal.idMeal) ? "★" : "☆"}
                        </button>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center justify-between mt-1">
                        <span>{meal.strCategory || "—"}</span>
                        <span>{formatMinutes(minutes)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </main>

        {/* Right: Details */}
        <aside className="lg:col-span-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 h-max sticky top-20">
          <h2 className="text-lg font-semibold mb-3">Details</h2>
          {!selectedMeal ? (
            <div className="text-sm text-gray-600 dark:text-gray-400">Select a recipe to see details.</div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <img src={selectedMeal.strMealThumb} alt={selectedMeal.strMeal} className="w-16 h-16 rounded-xl object-cover" />
                <div>
                  <h3 className="text-lg font-semibold">{selectedMeal.strMeal}</h3>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Category: <b>{selectedMeal.strCategory || "—"}</b></div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Time Taken: <b>{formatMinutes(estimateCookTime(selectedMeal))}</b></div>
                </div>
              </div>

              <div className="mb-4">
                <h4 className="font-medium mb-1">Required Ingredients</h4>
                <ul className="list-disc pl-5 space-y-1">
                  {extractIngredients(selectedMeal).map((x, i) => (
                    <li key={i}><span className="font-medium">{x.ingredient}</span>{x.measure ? ` — ${x.measure}` : ""}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium mb-1">Procedure</h4>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                  {selectedMeal.strInstructions || "—"}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Footer tiny note */}
      <footer className="max-w-7xl mx-auto px-4 pb-6 text-xs text-gray-500">
        Data from TheMealDB (public API). This is a demo app.
      </footer>
    </div>
  );
}
