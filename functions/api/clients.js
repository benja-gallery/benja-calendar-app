/* /api/clients — client CRM (לקוחות). Shape and verbs: _collection.js
   A client upsert also projects its timeline into history_logs (_shared.js). */
import { collection } from './_collection.js';

const routes = collection('clients');

export const onRequestOptions = routes.options;
export const onRequestGet = routes.get;
export const onRequestPost = routes.post;
export const onRequestDelete = routes.del;
