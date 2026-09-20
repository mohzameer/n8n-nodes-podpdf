import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PodPdfApi implements ICredentialType {
	name = 'podPdfApi';

	displayName = 'PodPDF API';

	icon: Icon = { light: 'file:../icons/podpdf.svg', dark: 'file:../icons/podpdf.dark.svg' };

	documentationUrl = 'https://apidocs.podpdf.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your PodPDF API key. Create one at https://app.podpdf.com under Settings → API Keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.podpdf.com',
			url: '/me',
			method: 'GET',
		},
	};
}
