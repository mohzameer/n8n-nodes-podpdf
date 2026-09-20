import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const BASE_URL = 'https://api.podpdf.com';

interface PodPdfErrorBody {
	error?: { code?: string; message?: string; details?: unknown };
}

function extractErrorBody(error: IDataObject): PodPdfErrorBody | undefined {
	const candidates = [
		(error.response as IDataObject | undefined)?.body,
		(error.response as IDataObject | undefined)?.data,
		((error.cause as IDataObject | undefined)?.response as IDataObject | undefined)?.data,
		error.description,
	];
	for (const candidate of candidates) {
		let body = candidate;
		if (typeof body === 'string') {
			try {
				body = JSON.parse(body);
			} catch {
				continue;
			}
		}
		if (body && typeof body === 'object' && 'error' in (body as IDataObject)) {
			return body as PodPdfErrorBody;
		}
	}
	return undefined;
}

/** Calls the PodPDF API with the node's credential and turns API errors into readable node errors. */
export async function podPdfApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	itemIndex = 0,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		json: true,
		headers: { Accept: 'application/json' },
	};
	if (body !== undefined) options.body = body;

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'podPdfApi',
			options,
		)) as IDataObject;
	} catch (error) {
		const apiBody = extractErrorBody(error as IDataObject);
		const code = apiBody?.error?.code;
		const message = apiBody?.error?.message;
		const status =
			((error as IDataObject).httpCode as string | undefined) ??
			String(
				((error as IDataObject).response as IDataObject | undefined)?.status ??
					((error as IDataObject).statusCode as number | undefined) ??
					'',
			);
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			itemIndex,
			httpCode: status || undefined,
			message: code ? `${code}: ${message ?? 'PodPDF API error'}` : undefined,
			description: apiBody?.error?.details ? JSON.stringify(apiBody.error.details) : undefined,
		});
	}
}

/** Downloads a signed PDF URL (no PodPDF credential needed) and returns it as a Buffer. */
export async function downloadPdf(this: IExecuteFunctions, url: string): Promise<Buffer> {
	const data = (await this.helpers.httpRequest({
		method: 'GET',
		url,
		encoding: 'arraybuffer',
		json: false,
	})) as ArrayBuffer | Buffer;
	return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Expands dotted keys into nested objects, so `customer.name` becomes
 * `{ customer: { name: … } }` — the shape the render API expects. Keys without
 * a dot are copied as they are, and a plain key wins over a dotted one.
 */
export function expandDottedKeys(data: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(data)) {
		if (!key.includes('.')) continue;
		const parts = key.split('.');
		const last = parts.pop() as string;
		let target = out;
		for (const part of parts) {
			const next = target[part];
			if (!next || typeof next !== 'object' || Array.isArray(next)) target[part] = {};
			target = target[part] as IDataObject;
		}
		target[last] = value;
	}
	for (const [key, value] of Object.entries(data)) {
		if (!key.includes('.')) out[key] = value;
	}
	return out;
}
