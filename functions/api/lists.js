/* /api/lists — smart checklists (רשימות). Shape and verbs: _collection.js */
import { collection } from './_collection.js';

const routes = collection('lists');

export const onRequestOptions = routes.options;
export const onRequestGet = routes.get;
export const onRequestPost = routes.post;
export const onRequestDelete = routes.del;
