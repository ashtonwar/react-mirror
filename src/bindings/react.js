import * as most from 'most'
import React from 'react'
import MirrorBackend from '../backend'
import shallowEqual from '../utils/shallowEqual'
import filterUnchanged from '../utils/streams/filterUnchanged'

const instantiseMapToProps = mapToProps => {
  let CALLED_ONCE
  const instantisedMapToProps = (state, props) => {
    let result = mapToProps(state, props)
    if (!CALLED_ONCE && typeof result === 'function') {
      mapToProps = result
      result = mapToProps(state, props)
    }
    CALLED_ONCE = true
    return result
  }
  return instantisedMapToProps
}

function createMirrorDecorator(config = {}) {
  return function decorateWithMirror(WrappedComponent) {
    let {name = [], state, mapToProps, pure} = config
    if (!(name instanceof Array)) name = [name]
    if (typeof mapToProps !== 'function') {
      mapToProps = (state, props) => ({...props, ...state})
    }
    if (!pure) pure = {propsEqual() {}, stateEqual() {}, propsStateEqual() {}}
    if (pure === true) pure = {}
    Object.assign(
      {
        propsEqual: shallowEqual,
        shallowEqual: shallowEqual,
        propsStateEqual: shallowEqual
      },
      pure
    )

    if (!WrappedComponent) {
      WrappedComponent = function Noop() {
        return null
      }
    }

    class Mirror extends React.Component {
      constructor(props, context) {
        super()
        this.state = {updateCount: 0, props: undefined}

        this.propsRecievedGenerator = function*() {
          while (true) {
            yield new Promise(resolve => (this.onReceivedProps = resolve))
          }
        }
        const $stateEnd = most.from(new Promise(resolve => (this.onStateEnd = resolve)))

        const {id, mirror, dispatch, streams} = MirrorBackend.addStore(context.id, {
          requesting: ['$state', '$props'],
          identifiers: [...config.name, Mirror.__COMPONENT_IDENTIFIER__],
          streams: (mirror, dispatch) => {
            const $props = filterUnchanged(
              pure.propsEqual.bind(this),
              most.from(this.propsRecievedGenerator)
            )
            if (!state) return {$props}
            let $state = filterUnchanged(pure.stateEqual.bind(this)).until(
              $stateEnd,
              state.call(this, mirror, dispatch)
            )
            return {$state, $props}
          },
          metadata: {
            instance: this
          }
        })
        Object.assign(this, {id, mirror, dispatch})

        filterUnchanged(
          pure.propsStateEqual.bind(this),
          most.combine(
            instantiseMapToProps(mapToProps).bind(this),
            streams.$state,
            streams.$props
          )
        ).observe(propsState => {
          this.setState(({updateCount}) => ({updateCount: updateCount + 1, propsState}))
        })
      }
      getWrappedInstance() {
        return this.wrappedInstance
      }
      getChildContext() {
        return {id: this.id}
      }
      componentWillReceiveProps(nextProps) {
        this.onReceivedProps(nextProps)
      }
      shouldComponentUpdate(nextProps, nextState) {
        return nextState.updateCount > this.state.updateCount
      }
      componentWillUnmount() {
        this.propsRecievedGenerator.return()
        this.onStateEnd()
        MirrorBackend.removeStore(this.id)
      }
      render() {
        if (this.state.updateCount === 0 && config.state) {
          return null
        }

        return React.createElement(WrappedComponent, {
          ...this.state.props,
          ref: ref => (this.wrappedInstance = ref),
          dispatch: this.dispatch
        })
      }
    }

    const _name = WrappedComponent.displayName || WrappedComponent.name || 'Component'
    Mirror.displayName = `Mirror(${_name})`
    Mirror.contextTypes = {id() {}}
    Mirror.childContextTypes = {id() {}}
    Mirror.__COMPONENT_IDENTIFIER__ = Mirror

    const createStaticCursors = () => {
      delete Mirror.mirror
      delete Mirror.dispatch
      if (Mirror !== Mirror.__COMPONENT_IDENTIFIER__) {
        Mirror.mirror = Mirror.__COMPONENT_IDENTIFIER__.mirror
        Mirror.dispatch = Mirror.__COMPONENT_IDENTIFIER__.dispatch
        return
      }

      const {mirror, dispatch} = MirrorBackend.addStore(null, {
        identifiers: ['MIRROR/static', `MIRROR/static/${_name}`],
        metadata: {
          static: Mirror
        }
      })

      Object.assign(Mirror, {
        mirror: mirror.all(Mirror),
        dispatch: dispatch.all(Mirror)
      })
    }

    Object.defineProperties(Mirror, {
      mirror: {get: () => (createStaticCursors(), Mirror.mirror)},
      dispatch: {get: () => (createStaticCursors(), Mirror.dispatch)}
    })

    Mirror.__WITH_NAME_CACHE__ = {}
    const withNameCache = Mirror.__COMPONENT_IDENTIFIER__.__WITH_NAME_CACHE__
    Mirror.withName = function withName(...name) {
      name = [].concat(...name, config.name).sort()
      const key = JSON.stringify(name) // TODO: support non-string names
      if (withNameCache[key]) return withNameCache[key]

      const renamedComponent = createMirrorDecorator({...config, name})(WrappedComponent)
      renamedComponent.__COMPONENT_IDENTIFIER__ = Mirror.__COMPONENT_IDENTIFIER__
      withNameCache[key] = renamedComponent
    }

    return Mirror
  }
}

export default createMirrorDecorator
