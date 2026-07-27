/* /api/notes — quick notes (פתקים). Shape and verbs: _collection.js */
import { collection } from './_collection.js';

const routes = collection('notes');

export const onRequestOptions = routes.options;
export const onRequestGet = routes.get;
export const onRequestPost = routes.post;
export const onRequestDelete = routes.del;
