import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookmarksAPI } from '../utils/api';
import { bookmarksQueryKey } from '../utils/queryClient';

// 🔹 Signets personnels d'un document, dans l'ordre des pages.
export function useBookmarks(id) {
	return useQuery({
		queryKey: bookmarksQueryKey(id),
		queryFn: () => bookmarksAPI.list(id),
	});
}

function _withBookmark(bookmarks = [], bookmark) {
	return [
		...bookmarks.filter((item) => item.page !== bookmark.page),
		bookmark,
	].toSorted((a, b) => a.page - b.page);
}

// mutate({ page, label? }) : pose le signet de la page ou change son libellé.
export function useSetBookmark(id) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ page, label }) => bookmarksAPI.set({ id, page, label }),
		onSuccess: (bookmark) =>
			queryClient.setQueryData(bookmarksQueryKey(id), (bookmarks) =>
				_withBookmark(bookmarks, bookmark),
			),
	});
}

// mutate(page)
export function useRemoveBookmark(id) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (page) => bookmarksAPI.remove({ id, page }),
		onSuccess: (_data, page) =>
			queryClient.setQueryData(bookmarksQueryKey(id), (bookmarks) =>
				bookmarks?.filter((bookmark) => bookmark.page !== page),
			),
	});
}
