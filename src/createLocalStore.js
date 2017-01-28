import _ from 'lodash'
import invariant from 'invariant'
import setPure from './utils/setPure'
import shallowEqual from './utils/shallowEqual'
import subNamesToKeys from './utils/subNamesToKeys'
import normalizeState from './utils/normalizeState'
import findStoreByContext from './utils/findStoreByContext'

const shouldUpdate = (pure, storeUpdated, subscribedTo, state, prevState) => {
  if (!subscribedTo.some((key) => key === storeUpdated)) return false
  if (!pure) return true
  if (typeof pure === 'function') return pure(state, prevState)
  if (!shallowEqual(state, prevState)) return true
  if (subscribedTo) {
    for (let key in subscribedTo) { // eslint-disable-line prefer-const
      if (!shallowEqual(state.context[key], prevState.context[key])) return true
    }
  }
}

const _dispatch = (action = {}, context, instance) => {
  const originKey = instance.path.slice(-1)[0]
  let storeKey = originKey
  if (context) {
    const store = findStoreByContext(instance, context)
    invariant(store,
      `Could not find "${context}" among the ancestors of ` +
      `"${instance.constructor.displayName}". ` +
      'Check you passed the correct value to dispatch and ' +
      `passed "${context}" to contextPublish for a parent store.`
    )
    storeKey = store.meta.path.slice(-1)[0]
  }
  action = setPure(action, 'meta.store', storeKey)
  action = setPure(action, 'meta.origin', originKey)
  instance.rootStore.dispatch(action)
}

const dispatch = (instance) => (...args) => {
  const [type, context, payload, metadata] = args
  if (typeof type !== 'string') return _dispatch(type, context, instance)
  if (args.length === 1) return _dispatch({type}, null, instance)
  if (args.length === 2) return _dispatch({type, payload: context}, null, instance)
  if (args.length === 3) return _dispatch({type, payload}, context, instance)
  return _dispatch({type, payload, ...metadata}, context, instance)
}

export const createLocalStore = (instance, config, options) => {
  let {reducer = state => state, middleware = [], contextSubscribe = [], contextPublish} = config
  if (typeof middleware === 'function') middleware = [middleware]
  if (typeof contextSubscribe === 'string') contextSubscribe = [contextSubscribe]
  const {pure = true} = options
  const {rootStore, path} = instance
  const key = path.slice(-1)[0]
  rootStore.dispatch({
    type: '@@mirror/ADD_STORE',
    payload: {
      path, name: instance.constructor.displayName, instance,
      reducer, middleware, contextSubscribe, contextPublish
    }
  })
  let subscriptions = []
  let _state = {}
  let _context = {}
  const store = {
    dispatch: dispatch(instance),
    subscribe: f => {
      invariant(typeof f === 'function',
        `You must pass a function to subscribe (${instance.constructor.displayName})`
      )
      const _id = Math.random().toString().slice(2)
      const cancel = () => subscriptions = subscriptions.filter(({id}) => id === _id)
      subscriptions.push({f, cancel, id: _id})
      return cancel
    },
    subscribeParent: (f = () => {}) => {
      const cancel = () => subscriptions = subscriptions.filter(({id}) => id !== 'parent')
      cancel()
      subscriptions.push({f, cancel, id: 'parent'})
    },
    getState: () => _state,
    getStateContext: () => _context,
  }
  const contextSubscribeKeys = subNamesToKeys(contextSubscribe, path, rootStore.getState())
  const cancelRootSubscription =
    rootStore.subscribe((storeUpdated, action, rootState, rootPrevState) => {
      if (['@@mirror/ADD_STORE', '@@mirror/REMOVE_STORE'].includes(action.type)) return
      const {state, context} = normalizeState(contextSubscribe, path, rootState)
      const {state: prevState, context: prevContext} = normalizeState(contextSubscribe, path, rootPrevState)
      _state = state
      _context = context
      const updatedContextName = contextSubscribe[contextSubscribeKeys.indexOf(storeUpdated)]
      if (updatedContextName) store.dispatch('UPDATE_CONTEXT', updatedContextName)
      if (shouldUpdate(pure, storeUpdated, [...contextSubscribeKeys, key], {...state, context}, {...prevState, context: prevContext})) {
        subscriptions.forEach(({f}) => f(action, state, prevState))
      }
    })
  store.destroy = () => {
    subscriptions.forEach(({cancel}) => cancel())
    cancelRootSubscription()
    rootStore.dispatch({
      type: '@@mirror/REMOVE_STORE',
      payload: key
    })
  }
  return store
}

export default createLocalStore
