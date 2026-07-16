import type { Endpoint } from '../../config/types.js'
import type { PayloadRequest } from '../../types/index.js'
import type { UploadInstructions, UploadInstructionsRequest } from '../types.js'

import { getAccessResults } from '../../auth/getAccessResults.js'
import { APIError, Forbidden } from '../../errors/index.js'
import {
  deleteStagedFile,
  generateStagedUploadInstructions,
  uploadStagedFile,
} from '../stagedUpload.js'

const bytesToMB = (bytes: number) => bytes / 1024 / 1024

export const getUploadInstructions = async ({
  overrideAccess = false,
  req,
  ...upload
}: {
  overrideAccess?: boolean
  req: PayloadRequest
} & UploadInstructionsRequest): Promise<UploadInstructions> => {
  const collection = req.payload.collections[upload.collectionSlug]
  const uploadInstructions = collection?.config?.upload?.uploadInstructions

  if (!collection?.config?.upload) {
    throw new APIError(`Upload collection ${upload.collectionSlug} was not found`, 400)
  }

  const filesizeLimit = req.payload.config.upload.limits?.fileSize
  if (filesizeLimit && upload.filesize > filesizeLimit) {
    throw new APIError(
      `Exceeded file size limit. Limit: ${bytesToMB(filesizeLimit).toFixed(2)}MB, got: ${bytesToMB(upload.filesize).toFixed(2)}MB`,
      400,
    )
  }

  if (!uploadInstructions && !overrideAccess) {
    // Staged uploads write to Payload before a document is saved. Require a signed-in user who
    // can create or update documents in this collection.
    if (!req.user) {
      throw new Forbidden(req.t)
    }

    const collectionPermissions = (await getAccessResults({ req })).collections?.[
      upload.collectionSlug
    ]

    if (!collectionPermissions?.create && !collectionPermissions?.update) {
      throw new Forbidden(req.t)
    }
  }

  return uploadInstructions
    ? uploadInstructions.generate({ ...upload, overrideAccess, req })
    : generateStagedUploadInstructions({ ...upload, req })
}

export const uploadInstructionsEndpoint: Endpoint = {
  handler: async (req) => {
    if (!req.json) {
      throw new APIError('Content-Type expected to be application/json', 400)
    }

    const upload = (await req.json()) as null | Partial<UploadInstructionsRequest>
    if (
      !upload ||
      typeof upload.collectionSlug !== 'string' ||
      (upload.docPrefix !== undefined && typeof upload.docPrefix !== 'string') ||
      typeof upload.filename !== 'string' ||
      typeof upload.filesize !== 'number' ||
      !Number.isSafeInteger(upload.filesize) ||
      upload.filesize < 0 ||
      typeof upload.mimeType !== 'string'
    ) {
      throw new APIError('Invalid upload instructions request', 400)
    }

    const uploadRequest = upload as UploadInstructionsRequest
    return Response.json(await getUploadInstructions({ ...uploadRequest, req }))
  },
  method: 'post',
  path: '/upload-instructions',
}

/**
 * Stores or removes temporary files when no adapter-specific upload instructions are available.
 * PUT keeps the file until it is used in a document request.
 * DELETE removes a file the client no longer needs.
 */
export const stagedUploadEndpoints: Endpoint[] = [
  {
    handler: uploadStagedFile,
    method: 'put',
    path: '/upload-instructions/:uploadId',
  },
  {
    handler: deleteStagedFile,
    method: 'delete',
    path: '/upload-instructions/:uploadId',
  },
]
