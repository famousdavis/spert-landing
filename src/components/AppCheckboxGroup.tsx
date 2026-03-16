import { externalAppNames } from '@/data/apps';

const CHECKBOX_CLASS =
  'rounded border-zinc-300 text-spert-blue focus:ring-spert-blue dark:border-zinc-600 dark:bg-zinc-800 dark:focus:ring-blue-400';

export function AppCheckboxGroup() {
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Which app(s) does this relate to?
      </legend>
      <div className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800">
        {externalAppNames.map((name) => (
          <label
            key={name}
            className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            <input
              type="checkbox"
              name="app"
              value={name}
              className={CHECKBOX_CLASS}
            />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
