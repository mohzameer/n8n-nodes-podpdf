import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';

vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return { ...actual, sleep: vi.fn(async () => undefined) };
});

import { buildPdfOptions, PodPdf } from '../nodes/PodPdf/PodPdf.node';
import { PodPdfApi } from '../credentials/PodPdfApi.credentials';

type Params = Record<string, unknown>;

function makeContext(
	params: Params,
	responses: unknown[],
	opts: { continueOnFail?: boolean } = {},
) {
	const authCalls: Array<{ credential: string; options: IHttpRequestOptions }> = [];
	const plainCalls: IHttpRequestOptions[] = [];
	const queue = [...responses];

	const httpRequestWithAuthentication = vi.fn(
		async (credential: string, options: IHttpRequestOptions) => {
			authCalls.push({ credential, options });
			const next = queue.shift();
			if (next instanceof Error) throw next;
			return next;
		},
	);
	const httpRequest = vi.fn(async (options: IHttpRequestOptions) => {
		plainCalls.push(options);
		return Buffer.from('%PDF-1.7 fake');
	});
	const prepareBinaryData = vi.fn(async (buffer: Buffer, fileName: string, mimeType: string) => ({
		data: buffer.toString('base64'),
		fileName,
		mimeType,
	}));

	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getNode: () => ({
			name: 'PodPDF',
			type: 'n8n-nodes-podpdf.podPdf',
			typeVersion: 1,
			parameters: {},
		}),
		continueOnFail: () => opts.continueOnFail ?? false,
		helpers: { httpRequestWithAuthentication, httpRequest, prepareBinaryData },
	} as unknown as IExecuteFunctions;

	return { ctx, authCalls, plainCalls, prepareBinaryData };
}

const quickjobResponse = {
	job_id: 'job_123',
	pages: 1,
	truncated: false,
	download_url: 'https://files.podpdf.com/job_123.pdf?sig=abc',
	download_url_expires_at: '2026-09-19T12:00:00Z',
};

describe('PodPdfApi credential', () => {
	const cred = new PodPdfApi();

	it('sends the API key as X-API-Key', () => {
		expect(cred.name).toBe('podPdfApi');
		expect(cred.properties[0]).toMatchObject({ name: 'apiKey', typeOptions: { password: true } });
		expect(cred.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { 'X-API-Key': '={{$credentials.apiKey}}' } },
		});
	});

	it('tests the connection with GET /me', () => {
		expect(cred.test.request).toEqual({
			baseURL: 'https://api.podpdf.com',
			url: '/me',
			method: 'GET',
		});
	});
});

describe('buildPdfOptions', () => {
	it('returns undefined when nothing is set', () => {
		expect(buildPdfOptions({})).toBeUndefined();
		expect(buildPdfOptions({ margin: '  ', pageRanges: '' })).toBeUndefined();
	});

	it('expands margin to four sides and keeps only set fields', () => {
		expect(buildPdfOptions({ format: 'Letter', margin: '20mm', scale: 0.8 })).toEqual({
			format: 'Letter',
			margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
			scale: 0.8,
		});
	});
});

describe('PodPdf node', () => {
	const node = new PodPdf();

	beforeEach(() => vi.clearAllMocks());

	it('Generate PDF posts to /quickjob with store:true and downloads the file', async () => {
		const { ctx, authCalls, plainCalls, prepareBinaryData } = makeContext(
			{
				resource: 'pdf',
				operation: 'generate',
				inputType: 'html',
				html: '<h1>Hi</h1>',
				downloadFile: true,
				options: { format: 'A4', landscape: true, margin: '10mm' },
			},
			[quickjobResponse],
		);

		const [out] = await node.execute.call(ctx);

		expect(authCalls).toHaveLength(1);
		expect(authCalls[0].credential).toBe('podPdfApi');
		expect(authCalls[0].options).toMatchObject({
			method: 'POST',
			url: 'https://api.podpdf.com/quickjob',
			json: true,
		});
		expect(authCalls[0].options.body).toEqual({
			input_type: 'html',
			html: '<h1>Hi</h1>',
			options: {
				format: 'A4',
				landscape: true,
				margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
			},
			store: true,
		});

		expect(plainCalls[0]).toMatchObject({
			method: 'GET',
			url: quickjobResponse.download_url,
			encoding: 'arraybuffer',
		});
		expect(prepareBinaryData).toHaveBeenCalledWith(
			expect.any(Buffer),
			'job_123.pdf',
			'application/pdf',
		);
		expect(out[0].json).toEqual(quickjobResponse);
		expect(out[0].binary?.data).toMatchObject({
			mimeType: 'application/pdf',
			fileName: 'job_123.pdf',
		});
	});

	it('Generate PDF from URL without options and without download', async () => {
		const { ctx, authCalls, plainCalls } = makeContext(
			{
				resource: 'pdf',
				operation: 'generate',
				inputType: 'url',
				url: 'https://example.com',
				downloadFile: false,
				options: {},
			},
			[quickjobResponse],
		);

		const [out] = await node.execute.call(ctx);

		expect(authCalls[0].options.body).toEqual({
			input_type: 'url',
			url: 'https://example.com',
			store: true,
		});
		expect(plainCalls).toHaveLength(0);
		expect(out[0].binary).toBeUndefined();
	});

	it('Render Template expands dotted keys into nested objects', async () => {
		const { ctx, authCalls } = makeContext(
			{
				resource: 'pdf',
				operation: 'renderTemplate',
				templateId: 'tpl_1',
				data: '{"invoice_number":"INV-1","customer.name":"Acme","customer.address":"1 Main St"}',
				filename: '',
				downloadFile: false,
			},
			[{ ...quickjobResponse, template_id: 'tpl_1' }],
		);

		await node.execute.call(ctx);

		expect(authCalls[0].options.body).toEqual({
			data: { invoice_number: 'INV-1', customer: { name: 'Acme', address: '1 Main St' } },
			store: true,
		});
	});

	it('Render Template posts data, filename and store:true', async () => {
		const { ctx, authCalls, prepareBinaryData } = makeContext(
			{
				resource: 'pdf',
				operation: 'renderTemplate',
				templateId: 'tpl_1',
				data: '{"customer":{"name":"Ada"}}',
				filename: 'invoice-1',
				downloadFile: true,
			},
			[{ ...quickjobResponse, template_id: 'tpl_1' }],
		);

		await node.execute.call(ctx);

		expect(authCalls[0].options).toMatchObject({
			method: 'POST',
			url: 'https://api.podpdf.com/templates/tpl_1/render',
			body: { data: { customer: { name: 'Ada' } }, filename: 'invoice-1', store: true },
		});
		expect(prepareBinaryData).toHaveBeenCalledWith(
			expect.any(Buffer),
			'invoice-1.pdf',
			'application/pdf',
		);
	});

	it('Start Long Job posts to /longjob without store', async () => {
		const { ctx, authCalls } = makeContext(
			{
				resource: 'job',
				operation: 'startLongJob',
				inputType: 'markdown',
				markdown: '# Report',
				waitForCompletion: false,
				options: { printBackground: false },
			},
			[{ job_id: 'job_9', status: 'queued' }],
		);

		const [out] = await node.execute.call(ctx);

		expect(authCalls[0].options).toMatchObject({
			method: 'POST',
			url: 'https://api.podpdf.com/longjob',
			body: { input_type: 'markdown', markdown: '# Report', options: { printBackground: false } },
		});
		expect(authCalls[0].options.body).not.toHaveProperty('store');
		expect(out[0].json).toEqual({ job_id: 'job_9', status: 'queued' });
	});

	it('Start Long Job with Wait for Completion polls and returns the download link', async () => {
		const link = { job_id: 'job_9', download_url: 'https://x/y.pdf', expires_in_seconds: 3600 };
		const { ctx, authCalls } = makeContext(
			{
				resource: 'job',
				operation: 'startLongJob',
				inputType: 'html',
				html: '<p>x</p>',
				waitForCompletion: true,
				options: {},
			},
			[
				{ job_id: 'job_9', status: 'queued' },
				{ job_id: 'job_9', status: 'processing' },
				{ job_id: 'job_9', status: 'completed' },
				link,
			],
		);

		const [out] = await node.execute.call(ctx);

		expect(authCalls.map((c) => `${c.options.method} ${c.options.url}`)).toEqual([
			'POST https://api.podpdf.com/longjob',
			'GET https://api.podpdf.com/jobs/job_9',
			'GET https://api.podpdf.com/jobs/job_9',
			'GET https://api.podpdf.com/jobs/job_9/download',
		]);
		expect(out[0].json).toEqual(link);
	});

	it('Get Job and Get Download Link call the job endpoints', async () => {
		const get = makeContext({ resource: 'job', operation: 'get', jobId: 'job_5' }, [
			{ job_id: 'job_5', status: 'completed' },
		]);
		await node.execute.call(get.ctx);
		expect(get.authCalls[0].options).toMatchObject({
			method: 'GET',
			url: 'https://api.podpdf.com/jobs/job_5',
		});

		const dl = makeContext({ resource: 'job', operation: 'getDownloadLink', jobId: 'job_5' }, [
			{ job_id: 'job_5', download_url: 'https://x' },
		]);
		await node.execute.call(dl.ctx);
		expect(dl.authCalls[0].options).toMatchObject({
			method: 'GET',
			url: 'https://api.podpdf.com/jobs/job_5/download',
		});
	});

	it('surfaces the API error code and message', async () => {
		const apiError = Object.assign(new Error('Request failed with status code 402'), {
			httpCode: '402',
			response: {
				status: 402,
				body: { error: { code: 'UPGRADE_REQUIRED', message: 'A paid plan is required' } },
			},
		});
		const { ctx } = makeContext(
			{ resource: 'pdf', operation: 'generate', inputType: 'html', html: '<p/>', options: {} },
			[apiError],
		);

		await expect(node.execute.call(ctx)).rejects.toThrow(
			'UPGRADE_REQUIRED: A paid plan is required',
		);
	});

	it('returns the error as JSON when Continue On Fail is on', async () => {
		const { ctx } = makeContext(
			{ resource: 'pdf', operation: 'generate', inputType: 'html', html: '<p/>', options: {} },
			[new Error('boom')],
			{ continueOnFail: true },
		);

		const [out] = await node.execute.call(ctx);
		expect(out[0].json.error).toBeTruthy();
		expect((out[0].json as IDataObject).error).toBeTypeOf('string');
	});
});
