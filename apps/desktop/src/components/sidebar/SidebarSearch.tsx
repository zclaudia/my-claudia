import { FileText, Wrench } from 'lucide-react';
import { SearchFilters } from '../SearchFilters';
import type { SidebarSearchProps } from './types';

function normalizeSearchPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

export function SidebarSearch({ search, isMobile, sessions, onResultSelect }: SidebarSearchProps) {
  const {
    searchQuery, setSearchQuery, searchResults, setSearchResults, isSearching,
    searchHistory, showSearchHistory, showFilters, setShowFilters, searchFilters,
    hasMoreResults, isLoadingMore, searchInputRef, searchResultsContainerRef,
    handleSearch, handleLoadMore, handleSelectHistoryItem, handleSearchFocus,
    handleSearchBlur, handleClearHistory, handleFiltersChange,
  } = search;

  if (isMobile) {
    return (
      <>
        {/* Search */}
        <div className="px-3 py-2 border-b border-border relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder="Search messages..."
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="w-full px-3 py-2.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>

        {/* Search History */}
        {showSearchHistory && !searchQuery.trim() && searchHistory.length > 0 && (
          <div className="border-b border-border max-h-60 overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 bg-secondary/50">
              <span className="text-xs text-muted-foreground font-medium">Recent Searches</span>
              <button
                onClick={handleClearHistory}
                className="text-xs text-muted-foreground hover:text-foreground px-1"
              >
                Clear
              </button>
            </div>
            {searchHistory.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleSelectHistoryItem(entry.query)}
                className="w-full px-3 py-2.5 text-left text-sm hover:bg-secondary active:bg-secondary border-b border-border/50 last:border-0"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate flex-1">{entry.query}</span>
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                    {entry.resultCount}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Search Results */}
        {searchQuery.trim() && (
          <div ref={searchResultsContainerRef} className="border-b border-border max-h-60 overflow-y-auto">
            {isSearching ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
            ) : searchResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
            ) : (
              <>
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      onResultSelect(r.sessionId, r.id, r.ownerBackendId);
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs hover:bg-secondary active:bg-secondary border-b border-border/50 last:border-0"
                  >
                    <div className="font-medium text-foreground truncate">{r.sessionName || 'Untitled'}</div>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 whitespace-normal break-words">
                      {normalizeSearchPreview(r.content)}
                    </div>
                    {r.resultType && r.resultType !== 'message' && (
                      <div className="text-xs text-primary mt-1">
                        {r.resultType === 'file' ? <span className="inline-flex items-center gap-1"><FileText size={11} strokeWidth={1.75} /> File</span> : <span className="inline-flex items-center gap-1"><Wrench size={11} strokeWidth={1.75} /> Tool</span>}
                      </div>
                    )}
                  </button>
                ))}
                {hasMoreResults && (
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="w-full px-3 py-2 text-xs text-primary hover:bg-secondary disabled:opacity-50"
                  >
                    {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} shown)`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </>
    );
  }

  // Desktop variant
  return (
    <>
      {/* Search */}
      <div className="px-3 py-2 relative">
        <div className="flex items-center gap-1">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder="Search messages..."
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 px-2.5 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1 rounded hover:bg-secondary ${showFilters ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}
            title="Filters"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
        </div>

        {/* Search History Dropdown */}
        {showSearchHistory && !searchQuery.trim() && searchHistory.length > 0 && (
          <div className="absolute top-full left-3 right-3 mt-1 bg-card border border-border rounded shadow-lg z-50 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
              <span className="text-xs text-muted-foreground font-medium">Recent Searches</span>
              <button
                onClick={handleClearHistory}
                className="text-xs text-muted-foreground hover:text-foreground px-1"
              >
                Clear
              </button>
            </div>
            {searchHistory.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleSelectHistoryItem(entry.query)}
                className="w-full px-2 py-1.5 text-left text-sm hover:bg-secondary flex items-center justify-between group"
              >
                <span className="truncate flex-1">{entry.query}</span>
                <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                  {entry.resultCount} results
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Search Filters */}
        {showFilters && (
          <div className="absolute top-full left-3 right-3 mt-1 z-50">
            <SearchFilters
              filters={searchFilters}
              sessions={sessions}
              onFiltersChange={handleFiltersChange}
              onClose={() => setShowFilters(false)}
            />
          </div>
        )}
      </div>

      {/* Search Results */}
      {searchQuery.trim() && (
        <div ref={searchResultsContainerRef} className="border-b border-border max-h-48 overflow-y-auto mx-2">
          {isSearching ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</div>
          ) : searchResults.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No results</div>
          ) : (
            <>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onResultSelect(r.sessionId, r.id, r.ownerBackendId);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-secondary border-b border-border/50 last:border-0"
                >
                  <div className="font-medium text-foreground truncate">{r.sessionName || 'Untitled'}</div>
                  <div className="text-muted-foreground mt-0.5 line-clamp-2 whitespace-normal break-words">
                    {normalizeSearchPreview(r.content)}
                  </div>
                  {r.resultType && r.resultType !== 'message' && (
                    <div className="text-xs text-primary mt-0.5">
                      {r.resultType === 'file' ? <span className="inline-flex items-center gap-1"><FileText size={11} strokeWidth={1.75} /> File</span> : <span className="inline-flex items-center gap-1"><Wrench size={11} strokeWidth={1.75} /> Tool</span>}
                    </div>
                  )}
                </button>
              ))}
              {hasMoreResults && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full px-2 py-1.5 text-xs text-primary hover:bg-secondary disabled:opacity-50"
                >
                  {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} shown)`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
