import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import {
	jsonParse,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
} from 'n8n-workflow';
import {
	generateFields,
	jobIdFields,
	jobOperations,
	pdfOperations,
	renderTemplateFields,
	resourceField,
	startLongJobFields,
} from './descriptions';
import { downloadPdf, expandDottedKeys, podPdfApiRequest } from './transport';

export const POLL_INTERVAL_MS = 5000;
export const MAX_POLLS = 36; // about 3 minutes
const FAILED_STATUSES = ['failed', 'partial_failed', 'timeout'];

interface PdfOptionsInput {
	format?: string;
	landscape?: boolean;
	margin?: string;
	printBackground?: boolean;
	scale?: number;
	pageRanges?: string;
}

/** Maps the "Options" collection to the API's `options` object, sending only fields the user set. */
export function buildPdfOptions(input: PdfOptionsInput): IDataObject | undefined {
	const options: IDataObject = {};
	if (input.format) options.format = input.format;
	if (input.landscape !== undefined) options.landscape = input.landscape;
	if (input.margin && input.margin.trim()) {
		const m = input.margin.trim();
		options.margin = { top: m, right: m, bottom: m, left: m };
	}
	if (input.printBackground !== undefined) options.printBackground = input.printBackground;
	if (input.scale !== undefined && input.scale !== null) options.scale = input.scale;
	if (input.pageRanges && input.pageRanges.trim()) options.pageRanges = input.pageRanges.trim();
	return Object.keys(options).length ? options : undefined;
}

function contentBody(ctx: IExecuteFunctions, i: number): IDataObject {
	const inputType = ctx.getNodeParameter('inputType', i) as string;
	const content = ctx.getNodeParameter(inputType, i) as string;
	if (!content) {
		throw new NodeOperationError(ctx.getNode(), `The ${inputType} field is empty`, {
			itemIndex: i,
		});
	}
	const body: IDataObject = { input_type: inputType, [inputType]: content };
	const options = buildPdfOptions(ctx.getNodeParameter('options', i, {}) as PdfOptionsInput);
	if (options) body.options = options;
	return body;
}

export class PodPdf implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PodPDF',
		name: 'podPdf',
		icon: { light: 'file:../../icons/podpdf.svg', dark: 'file:../../icons/podpdf.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Turn HTML, Markdown, URLs and templates into PDFs with the PodPDF API',
		defaults: {
			name: 'PodPDF',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'podPdfApi',
				required: true,
			},
		],
		properties: [
			resourceField,
			pdfOperations,
			jobOperations,
			...generateFields,
			...renderTemplateFields,
			...startLongJobFields,
			...jobIdFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let json: IDataObject;
				let downloadFile = false;
				let fileName: string | undefined;

				if (resource === 'pdf' && operation === 'generate') {
					const body = contentBody(this, i);
					body.store = true;
					json = await podPdfApiRequest.call(this, 'POST', '/quickjob', body, i);
					downloadFile = this.getNodeParameter('downloadFile', i, true) as boolean;
				} else if (resource === 'pdf' && operation === 'renderTemplate') {
					const templateId = (this.getNodeParameter('templateId', i) as string).trim();
					const rawData = this.getNodeParameter('data', i, '{}') as string | IDataObject;
					const data =
						typeof rawData === 'string'
							? jsonParse<IDataObject>(rawData || '{}', {
									errorMessage: 'Data must be a valid JSON object',
								})
							: rawData;
					if (data === null || typeof data !== 'object' || Array.isArray(data)) {
						throw new NodeOperationError(this.getNode(), 'Data must be a JSON object', {
							itemIndex: i,
						});
					}
					const filename = (this.getNodeParameter('filename', i, '') as string).trim();
					const body: IDataObject = { data: expandDottedKeys(data), store: true };
					if (filename) {
						body.filename = filename;
						fileName = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
					}
					json = await podPdfApiRequest.call(
						this,
						'POST',
						`/templates/${encodeURIComponent(templateId)}/render`,
						body,
						i,
					);
					downloadFile = this.getNodeParameter('downloadFile', i, true) as boolean;
				} else if (resource === 'job' && operation === 'startLongJob') {
					const body = contentBody(this, i);
					json = await podPdfApiRequest.call(this, 'POST', '/longjob', body, i);
					const wait = this.getNodeParameter('waitForCompletion', i, false) as boolean;
					if (wait && json.job_id) {
						json = await waitForJob.call(this, String(json.job_id), i);
					}
				} else if (resource === 'job' && operation === 'get') {
					const jobId = encodeURIComponent((this.getNodeParameter('jobId', i) as string).trim());
					json = await podPdfApiRequest.call(this, 'GET', `/jobs/${jobId}`, undefined, i);
				} else if (resource === 'job' && operation === 'getDownloadLink') {
					const jobId = encodeURIComponent((this.getNodeParameter('jobId', i) as string).trim());
					json = await podPdfApiRequest.call(this, 'GET', `/jobs/${jobId}/download`, undefined, i);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation "${operation}" for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const item: INodeExecutionData = { json, pairedItem: { item: i } };
				if (downloadFile && typeof json.download_url === 'string') {
					const buffer = await downloadPdf.call(this, json.download_url);
					item.binary = {
						data: await this.helpers.prepareBinaryData(
							buffer,
							fileName ?? `${String(json.job_id ?? 'podpdf')}.pdf`,
							'application/pdf',
						),
					};
				}
				returnData.push(item);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					// Already wrapped by podPdfApiRequest; re-wrapping returns the same error.
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/** Polls Get Job until it finishes, then returns Get Download Link's result. */
async function waitForJob(this: IExecuteFunctions, jobId: string, i: number): Promise<IDataObject> {
	const path = `/jobs/${encodeURIComponent(jobId)}`;
	let job: IDataObject = { job_id: jobId };
	for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
		await sleep(POLL_INTERVAL_MS);
		job = await podPdfApiRequest.call(this, 'GET', path, undefined, i);
		const status = String(job.status ?? '');
		if (status === 'completed') {
			return await podPdfApiRequest.call(this, 'GET', `${path}/download`, undefined, i);
		}
		if (FAILED_STATUSES.includes(status)) {
			throw new NodeOperationError(
				this.getNode(),
				`Job ${jobId} ended with status "${status}"${job.error_message ? `: ${String(job.error_message)}` : ''}`,
				{ itemIndex: i },
			);
		}
	}
	// Still running after ~3 minutes: return the latest status so the workflow can check again later.
	return job;
}
