'use client';

import { useEffect, useState, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Label } from '@mantle/web-ui/ui/label';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { useToast } from '@mantle/web-ui/ui/toast';
import { play } from '@/lib/sounds/play';

/** GET/PUT /api/settings/search-languages. Local type: the brain route is
 *  new and the shape is small, so it does not need a contract package bump. */
export type SearchLanguages = { languages: string[]; max: number };

export const SEARCH_LANGUAGES_KEY = ['settings', 'search-languages'] as const;

/** The field's text as codes: split on commas and spaces (pure). */
export function parseLanguageField(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The brain's search languages, under the Translator: the extra languages a
 * word search also looks in, by the query's translation (the Translator's
 * model, one short call per new query and language, then cached). Empty is
 * off. Saves only this one value.
 */
export function SearchLanguagesSetting() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: SEARCH_LANGUAGES_KEY,
    queryFn: () => apiFetch<SearchLanguages>('/api/settings/search-languages'),
  });
  const data = query.data;
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  const savedText = data?.languages.join(', ');
  useEffect(() => {
    if (savedText !== undefined) setValue(savedText);
  }, [savedText]);

  function save() {
    startTransition(async () => {
      try {
        const res = await apiSend<SearchLanguages>('/api/settings/search-languages', 'PUT', {
          languages: parseLanguageField(value),
        });
        play('success');
        toast.success(
          res.languages.length
            ? `Word search also looks in: ${res.languages.join(', ')}.`
            : 'Search languages off: word search looks in English only.',
        );
        await queryClient.invalidateQueries({ queryKey: SEARCH_LANGUAGES_KEY });
      } catch (err) {
        play('danger');
        toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  const max = data?.max ?? 3;
  return (
    <section className="space-y-2 rounded-md border border-border p-4">
      <Label htmlFor="search_languages" className="text-sm font-semibold">
        Search languages
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="search_languages"
          className="w-48"
          value={value}
          placeholder="none, e.g. es"
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={hintId('search_languages')}
        />
        <Button type="button" size="sm" onClick={save} disabled={pending || !data}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <FieldHint id="search_languages">
        Language codes, up to {max} (for example es, fr, pt-BR). Search by meaning already works
        across languages; search by words does not. With a code here, every word search also looks
        for the query&apos;s words in that language, translated by this worker&apos;s model: one
        short call per new query and language, then kept. Leave it empty if the brain&apos;s
        documents are in English.
      </FieldHint>
    </section>
  );
}
