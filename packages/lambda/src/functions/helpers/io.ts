import type {_Object} from '@aws-sdk/client-s3';
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from '@aws-sdk/client-s3';
import type {ReadStream} from 'fs';
import mimeTypes from 'mime-types';
import type {Readable} from 'stream';
import type {AwsRegion} from '../../pricing/aws-regions';
import type {CustomCredentials} from '../../shared/aws-clients';
import {getS3Client} from '../../shared/aws-clients';
import type {Privacy} from '../../shared/constants';
import type {DownloadBehavior} from '../../shared/content-disposition-header';
import {getContentDispositionHeader} from '../../shared/content-disposition-header';

export type LambdaLSInput = {
	bucketName: string;
	prefix: string;
	region: AwsRegion;
	expectedBucketOwner: string | null;
	continuationToken?: string;
};
export type LambdaLsReturnType = Promise<_Object[]>;

export const lambdaLs = async ({
	bucketName,
	prefix,
	region,
	expectedBucketOwner,
	continuationToken,
}: LambdaLSInput): LambdaLsReturnType => {
	try {
		const list = await getS3Client(region, null).send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: prefix,
				ExpectedBucketOwner: expectedBucketOwner ?? undefined,
				ContinuationToken: continuationToken,
			})
		);
		if (list.NextContinuationToken) {
			return [
				...(list.Contents ?? []),
				...(await lambdaLs({
					bucketName,
					prefix,
					expectedBucketOwner,
					region,
					continuationToken: list.NextContinuationToken,
				})),
			];
		}

		return list.Contents ?? [];
	} catch (err) {
		if (!expectedBucketOwner) {
			throw err;
		}

		// Prevent from accessing a foreign bucket, retry without ExpectedBucketOwner and see if it works. If it works then it's an owner mismatch.
		if ((err as Error).stack?.includes('AccessDenied')) {
			await getS3Client(region, null).send(
				new ListObjectsV2Command({
					Bucket: bucketName,
					Prefix: prefix,
				})
			);
			throw new Error(
				`Bucket owner mismatch: Expected the bucket ${bucketName} to be owned by you (AWS Account ID: ${expectedBucketOwner}) but it's not the case. Did you accidentially specify the wrong bucket?`
			);
		}

		throw err;
	}
};

export const lambdaDeleteFile = async ({
	bucketName,
	key,
	region,
	customCredentials,
}: {
	region: AwsRegion;
	bucketName: string;
	key: string;
	customCredentials: CustomCredentials | null;
}) => {
	await getS3Client(region, customCredentials).send(
		new DeleteObjectCommand({
			Bucket: bucketName,
			Key: key,
		})
	);
};

export const lambdaWriteFile = async ({
	bucketName,
	key,
	body,
	region,
	privacy,
	expectedBucketOwner,
	downloadBehavior,
	customCredentials,
}: {
	bucketName: string;
	key: string;
	body: ReadStream | string;
	region: AwsRegion;
	privacy: Privacy;
	expectedBucketOwner: string | null;
	downloadBehavior: DownloadBehavior | null;
	customCredentials: CustomCredentials | null;
}): Promise<void> => {
	await getS3Client(region, customCredentials).send(
		new PutObjectCommand({
			Bucket: bucketName,
			Key: key,
			Body: body,
			ACL:
				privacy === 'no-acl'
					? undefined
					: privacy === 'private'
					? 'private'
					: 'public-read',
			ExpectedBucketOwner: expectedBucketOwner ?? undefined,
			ContentType: mimeTypes.lookup(key) || 'application/octet-stream',
			ContentDisposition: getContentDispositionHeader(downloadBehavior),
		})
	);
};

export const lambdaReadFile = async ({
	bucketName,
	key,
	region,
	expectedBucketOwner,
}: {
	bucketName: string;
	key: string;
	region: AwsRegion;
	expectedBucketOwner: string;
}): Promise<Readable> => {
	const {Body} = await getS3Client(region, null).send(
		new GetObjectCommand({
			Bucket: bucketName,
			Key: key,
			ExpectedBucketOwner: expectedBucketOwner,
		})
	);
	return Body as Readable;
};
