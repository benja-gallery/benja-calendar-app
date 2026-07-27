/* /api/events — calendar events (יומן). Shape and verbs: _collection.js */
import { collection } from './_collection.js';

const routes = collection('events');

export const onRequestOptions = routes.options;
export const onRequestGet = routes.get;
export const onRequestPost = routes.post;
export const onRequestDelete = routes.del;
