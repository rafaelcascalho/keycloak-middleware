import { AxiosInstance, AxiosResponse } from 'axios'

import AccessToken from './AccessToken'
import {KeycloakConfig, User, UpdateCredentialOptions, Headers, Attribute} from './interfaces'

class UserManager {
  private readonly baseUrl: string
  private readonly token: AccessToken
  private readonly config: KeycloakConfig
  private readonly request: AxiosInstance

  constructor(config: KeycloakConfig, request: AxiosInstance | any, token: AccessToken) {
    this.config = config
    this.request = request
    this.token = token
    this.baseUrl = `/auth/admin/realms/${this.config.realm}/users`
  }

  async details(id: string) {
    const headers = await this.mountHeaders()

    const url = `${this.baseUrl}/${id}`
    const response = await this.request.get(url, { headers })

    return response?.data
  }

  async roles(id: string, clientsIds: Array<string> = [], includeRealmRoles = false) {
    const promises = []
    const headers = await this.mountHeaders()

    const realmRolesUrl = `${this.baseUrl}/${id}/role-mappings/realm/composite`

    // retrieve roles from each target client
    promises.push(...this.stackUpGetClientRolesRequests(id, clientsIds, headers))

    // retrieve roles from realm
    if (includeRealmRoles) {
      promises.push(this.request.get(realmRolesUrl, { headers }))
    }

    return this.batchAndParseRolesPromises(promises)
  }

  async create(user: User) {
    const { password, ...userData } = user
    const endpoint = this.baseUrl
    const headers = await this.mountHeaders()

    const response = await this.request.post(endpoint, userData, { headers })
    const userId: string = response.headers.location.split('/').pop()
    await Promise.allSettled([
      this.savePassword(userId, password, headers),
      this.verifyEmail(userId, headers)
    ])
  }

  async addAttributes(id: string, attributes: Attribute[]){
    const headers = await this.mountHeaders()
    const endpoint = `${this.baseUrl}/${id}`

    const previousAttributes: Attribute[] = await this.getAttributes(id)
    const combinedAttributes: Attribute[] = previousAttributes.concat(attributes)

    const mappedAttributes = new Map<string, string[]>()
    combinedAttributes.forEach((attribute) => {
      mappedAttributes.set(attribute.key, attribute.value)
    })
    
    const body = Object.fromEntries(mappedAttributes)

    await this.request.put(endpoint,{ attributes: body }, { headers })
  }

  async getAttributes(id: string): Promise<Attribute[]> {
    const headers = await this.mountHeaders()
    const endpoint = `${this.baseUrl}/${id}`

    const response = await this.request.get(endpoint, {headers})

    const parsedResponse: Attribute[] = []

    try{
      const entries = Object.entries(response?.data.attributes)

      entries.forEach((attribute) => {
        parsedResponse.push({key: attribute[0], value: attribute[1] as string []})
      })
    }catch (e) {
      console.log('Unable to parse response to Attribute array')
    }

    return parsedResponse;
  }

  // IMPROVE: the any types used in this function need to be replaced by a declared interface
  private async batchAndParseRolesPromises(promises: Array<Promise<AxiosResponse<any>>>) {
    const batchResponses = await Promise.allSettled(promises)
    const successes = batchResponses.filter(this.filterFulfilledResults)
    return successes.length ?
      successes :
      successes
        .map((response: any) => response.data.map((role: any) => role.name))
        .reduce(this.listRolesNames, [])
  }

  private stackUpGetClientRolesRequests(id: string, clientsIds: Array<string>, headers: object) {
    const promises: Promise<AxiosResponse<any>>[] = []
    const buildClientRolesUrl = (cid: string) => `${this.baseUrl}/${id}/role-mappings/clients/${cid}/composite`

    let clientRolesUrl: string
    clientsIds.forEach(async cid => {
      clientRolesUrl = buildClientRolesUrl(cid)
      promises.push(this.request.get(clientRolesUrl, { headers }))
    })

    return promises
  }

  private filterFulfilledResults(response: PromiseSettledResult<any>): AxiosResponse | null {
    return response.status === 'fulfilled' ? response.value : null
  }

  private listRolesNames(list: Array<string>, names: Array<string>) {
    return [...list, ...names]
  }

  private async mountHeaders() {
    const accessToken = await this.token.get()
    return { Authorization: `Bearer ${accessToken}` }
  }

  private async savePassword(id: string, credential: string, headers: Headers, options: UpdateCredentialOptions = {}) {
    const endpoint = `${this.baseUrl}/${id}/reset-password`
    const body = {
      type: "password",
      value: credential,
      temporary: options.temporary ? true : false
    }

    await this.request.put(endpoint, body, { headers })
  }

  private async verifyEmail(id: string, headers: Headers) {
    const endpoint = `${this.baseUrl}/${id}/send-verify-email`

    await this.request.put(endpoint, null, { headers })
  }
}

export default UserManager
