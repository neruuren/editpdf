import { useEffect, useRef } from 'react';
import { annotationSummary, annotationTypeLabel } from '../utils/annotations';
import './AnnotationList.css';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

// 🔹 Annotations du document (onglet « Annotations » du panneau de
// navigation), groupées par page : type, couleur, texte (commentaire ou
// texte surligné, venus du PDF : rendus comme du texte), auteur et date.
// `list` : useAnnotationList ; `onSelect(page, annotation)` y mène ;
// `selected` ({ page, id }) est marquée et gardée visible.
function AnnotationList({ list, selected, onSelect }) {
	const listRef = useRef(null);

	useEffect(() => {
		listRef.current
			?.querySelector('[aria-current="true"]')
			?.scrollIntoView?.({ block: 'nearest' });
	}, [selected]);

	if (list.pages.length === 0) {
		return (
			<p className="annotation-list__empty">
				{list.status === 'loading'
					? 'Lecture des annotations…'
					: list.status === 'error'
						? 'Impossible de lire les annotations.'
						: 'Ce document n’a pas d’annotation.'}
			</p>
		);
	}
	return (
		<div ref={listRef} className="annotation-list">
			{list.pages.map(({ index, annotations }) => (
				<section key={index} className="annotation-list__page">
					<h2 className="annotation-list__heading">Page {index + 1}</h2>
					<ul className="annotation-list__items" role="list">
						{annotations.map((annotation) => {
							const summary = annotationSummary(annotation);
							return (
								<li key={annotation.id}>
									<button
										type="button"
										className="annotation-list__item"
										aria-current={
											selected?.page === index && selected.id === annotation.id
												? 'true'
												: undefined
										}
										onClick={() => onSelect(index, annotation)}
									>
										<span className="annotation-list__type">
											<span
												className="annotation-list__color"
												style={{
													background: annotation.color ?? 'transparent',
												}}
												aria-hidden="true"
											/>
											{annotationTypeLabel(annotation.type)}
										</span>
										{summary && (
											<span className="annotation-list__summary">
												{summary}
											</span>
										)}
										{(annotation.author || annotation.modifiedAt) && (
											<span className="annotation-list__meta">
												{[
													annotation.author,
													annotation.modifiedAt &&
														DATE_FORMAT.format(new Date(annotation.modifiedAt)),
												]
													.filter(Boolean)
													.join(' · ')}
											</span>
										)}
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
			{list.isTruncated && (
				<p className="annotation-list__empty">
					Seules les premières annotations sont listées.
				</p>
			)}
		</div>
	);
}

export default AnnotationList;
