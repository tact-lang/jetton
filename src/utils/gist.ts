import {Address} from "@ton/core"
import {callGetMetadataFromTonCenter} from "./toncenter"

export const uploadDeployResultToGist = async (jettonMinterAddress: Address) => {
    const isUploadEnabled = process.env.GIST_UPLOAD_ENABLED === "true"

    if (!isUploadEnabled) {
        console.log("Gist upload is disabled.")
        return
    }

    const GIST_SECRET = process.env.GIST_SECRET
    if (!GIST_SECRET) {
        console.error("GIST_SECRET environment variable is not set.")
        return
    }

    const GIST_ID = process.env.GIST_ID
    if (!GIST_ID) {
        console.error("GIST_ID environment variable is not set.")
        return
    }

    try {
        const response = await callGetMetadataFromTonCenter(jettonMinterAddress)

        const gistContent = JSON.stringify(response, null, 2)

        const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${GIST_SECRET}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                files: {
                    "deploy-result.json": {
                        content: gistContent,
                    },
                },
            }),
        })

        if (!updateResponse.ok) {
            const error = await updateResponse.json()
            console.error("Failed to update Gist:", error)
            return
        }

        console.log("Gist updated successfully.")
    } catch (error) {
        console.error("An error occurred while updating the Gist:", error)
    }
}
