import { useState, useCallback, useRef, useEffect } from 'react';
import * as api from '../../services/api';
import type { SearchResult, SearchHistoryEntry, SearchFilters as Filters } from '../../services/api';

export interface SearchSidebarState {
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchHistory: SearchHistoryEntry[];
  showSearchHistory: boolean;
  showFilters: boolean;
  searchFilters: Filters;
  hasMoreResults: boolean;
  isLoadingMore: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  searchResultsContainerRef: React.RefObject<HTMLDivElement>;
  handleSearch: (query: string, filters?: Filters) => void;
  handleLoadMore: () => Promise<void>;
  handleSelectHistoryItem: (query: string) => void;
  handleSearchFocus: () => void;
  handleSearchBlur: () => void;
  handleClearHistory: () => Promise<void>;
  handleFiltersChange: (filters: Filters) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setShowFilters: (show: boolean) => void;
}

export function useSearchSidebar(): SearchSidebarState {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchFilters, setSearchFilters] = useState<Filters>({});
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const searchTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null!);
  const searchResultsContainerRef = useRef<HTMLDivElement>(null!);

  // Load search history on mount
  useEffect(() => {
    const loadSearchHistory = async () => {
      try {
        const history = await api.getSearchHistory();
        setSearchHistory(history);
      } catch (error) {
        console.error('Failed to load search history:', error);
      }
    };
    loadSearchHistory();
  }, []);

  const handleSearch = useCallback((query: string, filters?: Filters) => {
    setSearchQuery(query);
    setShowSearchHistory(false);
    setSearchOffset(0);
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setHasMoreResults(false);
      return;
    }
    setIsSearching(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const filtersToUse = filters || searchFilters;
        const pageSize = 50;
        const results = await api.searchMessages(query.trim(), { ...filtersToUse, limit: pageSize, offset: 0 });
        setSearchResults(results);
        setHasMoreResults(results.length === pageSize);
        const history = await api.getSearchHistory();
        setSearchHistory(history);
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
        setHasMoreResults(false);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [searchFilters]);

  const handleLoadMore = useCallback(async () => {
    if (!searchQuery.trim() || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const pageSize = 50;
      const newOffset = searchOffset + pageSize;
      const results = await api.searchMessages(searchQuery.trim(), {
        ...searchFilters,
        limit: pageSize,
        offset: newOffset
      });

      setSearchResults(prev => [...prev, ...results]);
      setSearchOffset(newOffset);
      setHasMoreResults(results.length === pageSize);
    } catch (error) {
      console.error('Load more failed:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [searchQuery, searchFilters, searchOffset, isLoadingMore]);

  const handleSelectHistoryItem = useCallback((query: string) => {
    handleSearch(query);
    setShowSearchHistory(false);
  }, [handleSearch]);

  const handleSearchFocus = useCallback(() => {
    if (!searchQuery.trim() && searchHistory.length > 0) {
      setShowSearchHistory(true);
    }
  }, [searchQuery, searchHistory.length]);

  const handleSearchBlur = useCallback(() => {
    setTimeout(() => setShowSearchHistory(false), 200);
  }, []);

  const handleClearHistory = useCallback(async () => {
    try {
      await api.clearSearchHistory();
      setSearchHistory([]);
      setShowSearchHistory(false);
    } catch (error) {
      console.error('Failed to clear search history:', error);
    }
  }, []);

  const handleFiltersChange = useCallback((filters: Filters) => {
    setSearchFilters(filters);
    if (searchQuery.trim()) {
      handleSearch(searchQuery, filters);
    }
  }, [searchQuery, handleSearch]);

  // Scroll to top on new search
  useEffect(() => {
    if (searchOffset !== 0 || isLoadingMore) return;
    searchResultsContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [searchQuery, searchOffset, isLoadingMore, searchResults.length]);

  return {
    searchQuery,
    searchResults,
    isSearching,
    searchHistory,
    showSearchHistory,
    showFilters,
    searchFilters,
    hasMoreResults,
    isLoadingMore,
    searchInputRef,
    searchResultsContainerRef,
    handleSearch,
    handleLoadMore,
    handleSelectHistoryItem,
    handleSearchFocus,
    handleSearchBlur,
    handleClearHistory,
    handleFiltersChange,
    setSearchQuery,
    setSearchResults,
    setShowFilters,
  };
}
