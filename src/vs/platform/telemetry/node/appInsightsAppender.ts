/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TelemetryClient } from 'applicationinsights';
import { onUnexpectedError } from 'vs/base/common/errors';
import { mixin } from 'vs/base/common/objects';
import { ITelemetryAppender, validateTelemetryData } from 'vs/platform/telemetry/common/telemetryUtils';

async function getClient(aiKey: string): Promise<TelemetryClient> {
	const appInsights = await import('applicationinsights');
	let client: TelemetryClient;
	if (appInsights.defaultClient) {
		client = new appInsights.TelemetryClient(aiKey);
		client.channel.setUseDiskRetryCaching(true);
	} else {
		appInsights.setup(aiKey)
			.setAutoCollectRequests(false)
			.setAutoCollectPerformance(false)
			.setAutoCollectExceptions(false)
			.setAutoCollectDependencies(false)
			.setAutoDependencyCorrelation(false)
			.setAutoCollectConsole(false)
			.setInternalLogging(false, false)
			.setUseDiskRetryCaching(true)
			.start();
		client = appInsights.defaultClient;
	}

	if (aiKey.indexOf('AIF-') === 0) {
		client.config.endpointUrl = 'https://mobile.events.data.microsoft.com/collect/v1';
	}
	return client;
}


export class AppInsightsAppender implements ITelemetryAppender {

	private _aiClient: string | TelemetryClient | undefined | null;
	private _asyncAIClient: Promise<TelemetryClient> | null;

	constructor(
		private _eventPrefix: string,
		private _defaultData: { [key: string]: any } | null,
		aiKeyOrClientFactory: string | (() => TelemetryClient), // allow factory function for testing
	) {
		if (!this._defaultData) {
			this._defaultData = Object.create(null);
		}

		this._aiClient = null
		this._asyncAIClient = null;
	}

	private _withAIClient(callback: (aiClient: TelemetryClient) => void): void {
		if (!this._aiClient) {
			return;
		}

		if (typeof this._aiClient !== 'string') {
			callback(this._aiClient);
			return;
		}

		if (!this._asyncAIClient) {
			this._asyncAIClient = getClient(this._aiClient);
		}

		this._asyncAIClient.then(
			(aiClient) => {
				callback(aiClient);
			},
			(err) => {
				onUnexpectedError(err);
				console.error(err);
			}
		);
	}

	log(eventName: string, data?: any): void {
		if (!this._aiClient) {
			return;
		}
		data = mixin(data, this._defaultData);
		data = validateTelemetryData(data);

		// Attemps to suppress https://github.com/microsoft/vscode/issues/140624
		try {
			this._withAIClient((aiClient) => aiClient.trackEvent({
				name: this._eventPrefix + '/' + eventName,
				properties: data.properties,
				measurements: data.measurements
			}));
		} catch { }
	}

	flush(): Promise<any> {
		if (this._aiClient) {
			return new Promise(resolve => {
				this._withAIClient((aiClient) => {
					// Attempts to suppress https://github.com/microsoft/vscode/issues/140624
					try {
						aiClient.flush({
							callback: () => {
								// all data flushed
								this._aiClient = undefined;
								resolve(undefined);
							}
						});
					} catch { }
				});
			});
		}
		return Promise.resolve(undefined);
	}
}
