/* /api/tasks — tasks engine (משימות). Shape and verbs: _collection.js */
import { collection } from './_collection.js';

const routes = collection('tasks');

export const onRequestOptions = routes.options;
export const onRequestGet = routes.get;
export const onRequestPost = routes.post;
export const onRequestDelete = routes.del;
