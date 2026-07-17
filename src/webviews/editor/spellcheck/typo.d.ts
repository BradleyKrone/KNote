// Ambient types for typo-js (ships no types of its own) and for the bundled
// dictionary files, which esbuild inlines as plain strings (see esbuild.mjs's
// `.aff`/`.dic` text loaders).

declare module 'typo-js' {
  interface TypoSettings {
    platform?: string
    dictionaryPath?: string
    flags?: Record<string, unknown>
    asyncLoad?: boolean
    loadedCallback?: (typo: Typo) => void
  }

  class Typo {
    constructor(dictionary?: string, affData?: string, wordsData?: string, settings?: TypoSettings)
    /** True when the word is spelled correctly. */
    check(word: string): boolean
    /** Up to `limit` suggested corrections, best first. */
    suggest(word: string, limit?: number): string[]
  }

  export default Typo
}

declare module '*.aff' {
  const data: string
  export default data
}

declare module '*.dic' {
  const data: string
  export default data
}
