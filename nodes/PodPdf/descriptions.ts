import type { INodeProperties } from 'n8n-workflow';

const showFor = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

const pdfOptions = (operation: string[], resource: string): INodeProperties => ({
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(resource, operation),
	options: [
		{
			displayName: 'Format',
			name: 'format',
			type: 'options',
			options: [
				{ name: 'A3', value: 'A3' },
				{ name: 'A4', value: 'A4' },
				{ name: 'A5', value: 'A5' },
				{ name: 'Legal', value: 'Legal' },
				{ name: 'Letter', value: 'Letter' },
				{ name: 'Tabloid', value: 'Tabloid' },
			],
			default: 'A4',
			description: 'Paper size',
		},
		{
			displayName: 'Landscape',
			name: 'landscape',
			type: 'boolean',
			default: false,
			description: 'Whether to use landscape orientation',
		},
		{
			displayName: 'Margin',
			name: 'margin',
			type: 'string',
			default: '',
			placeholder: '20mm',
			description: 'One CSS length applied to all four sides, e.g. 20mm or 0.5in',
		},
		{
			displayName: 'Page Ranges',
			name: 'pageRanges',
			type: 'string',
			default: '',
			placeholder: '1-3, 5',
			description: 'Pages to keep, e.g. 1-3, 5. Leave empty for all pages.',
		},
		{
			displayName: 'Print Background',
			name: 'printBackground',
			type: 'boolean',
			default: true,
			description: 'Whether to print background colors and images',
		},
		{
			displayName: 'Scale',
			name: 'scale',
			type: 'number',
			typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 2 },
			default: 1,
			description: 'Rendering scale between 0.1 and 2',
		},
	],
});

const inputTypeField = (
	resource: string,
	operation: string[],
	allowUrl: boolean,
): INodeProperties => ({
	displayName: 'Input Type',
	name: 'inputType',
	type: 'options',
	required: true,
	options: [
		{ name: 'HTML', value: 'html' },
		{ name: 'Markdown', value: 'markdown' },
		...(allowUrl ? [{ name: 'URL', value: 'url' }] : []),
	],
	default: 'html',
	description: 'What kind of content to convert',
	displayOptions: showFor(resource, operation),
});

const contentFields = (resource: string, operation: string[]): INodeProperties[] => [
	{
		displayName: 'HTML',
		name: 'html',
		type: 'string',
		typeOptions: { rows: 6 },
		required: true,
		default: '',
		placeholder: '<h1>Hello</h1>',
		description: 'HTML to convert',
		displayOptions: { show: { resource: [resource], operation, inputType: ['html'] } },
	},
	{
		displayName: 'Markdown',
		name: 'markdown',
		type: 'string',
		typeOptions: { rows: 6 },
		required: true,
		default: '',
		placeholder: '# Hello',
		description: 'Markdown to convert',
		displayOptions: { show: { resource: [resource], operation, inputType: ['markdown'] } },
	},
];

const downloadFileField = (resource: string, operation: string[]): INodeProperties => ({
	displayName: 'Download File',
	name: 'downloadFile',
	type: 'boolean',
	default: true,
	description:
		'Whether to download the PDF and output it as binary property "data" in addition to the JSON with the download link',
	displayOptions: showFor(resource, operation),
});

export const resourceField: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Job', value: 'job' },
		{ name: 'PDF', value: 'pdf' },
	],
	default: 'pdf',
};

export const pdfOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['pdf'] } },
	options: [
		{
			name: 'Generate PDF',
			value: 'generate',
			description: 'Convert HTML, Markdown or a URL to a PDF (up to 25 pages and 30 seconds)',
			action: 'Generate a PDF',
		},
		{
			name: 'Render Template',
			value: 'renderTemplate',
			description: 'Fill a saved PodPDF template with data and render it to a PDF',
			action: 'Render a template',
		},
	],
	default: 'generate',
};

export const jobOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['job'] } },
	options: [
		{
			name: 'Get Download Link',
			value: 'getDownloadLink',
			description: 'Get a fresh signed download URL for a finished job',
			action: 'Get a download link',
		},
		{
			name: 'Get Job',
			value: 'get',
			description: 'Get the status and details of a job',
			action: 'Get a job',
		},
		{
			name: 'Start Long Job',
			value: 'startLongJob',
			description: 'Queue a large HTML or Markdown document (up to 100 pages)',
			action: 'Start a long job',
		},
	],
	default: 'startLongJob',
};

export const generateFields: INodeProperties[] = [
	inputTypeField('pdf', ['generate'], true),
	...contentFields('pdf', ['generate']),
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com',
		description: 'Public HTTPS URL of the page to convert',
		displayOptions: { show: { resource: ['pdf'], operation: ['generate'], inputType: ['url'] } },
	},
	downloadFileField('pdf', ['generate']),
	pdfOptions(['generate'], 'pdf'),
];

export const renderTemplateFields: INodeProperties[] = [
	{
		displayName: 'Template ID',
		name: 'templateId',
		type: 'string',
		required: true,
		default: '',
		description:
			'ID of the template. Copy it from My templates in the PodPDF dashboard (https://app.podpdf.com).',
		displayOptions: showFor('pdf', ['renderTemplate']),
	},
	{
		displayName: 'Data',
		name: 'data',
		type: 'json',
		required: true,
		default: '{}',
		description: 'JSON object with values for the template fields',
		displayOptions: showFor('pdf', ['renderTemplate']),
	},
	{
		displayName: 'Filename',
		name: 'filename',
		type: 'string',
		default: '',
		placeholder: 'invoice-1001.pdf',
		description: 'Optional file name for the PDF',
		displayOptions: showFor('pdf', ['renderTemplate']),
	},
	downloadFileField('pdf', ['renderTemplate']),
];

export const startLongJobFields: INodeProperties[] = [
	inputTypeField('job', ['startLongJob'], false),
	...contentFields('job', ['startLongJob']),
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: false,
		description:
			'Whether to poll the job every 5 seconds for up to 3 minutes and return its download link once it finishes',
		displayOptions: showFor('job', ['startLongJob']),
	},
	pdfOptions(['startLongJob'], 'job'),
];

export const jobIdFields: INodeProperties[] = [
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the job, as returned by Generate PDF, Render Template or Start Long Job',
		displayOptions: showFor('job', ['get', 'getDownloadLink']),
	},
];
