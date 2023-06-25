export type TransportControlsProps = {
  disableHybridNavDescendantsIfBlurred: boolean
  hybridNavFocusable: boolean
  focusId: string
  className: string
  idomKey: string
  data: {
    buttons: Array<{
      type: string
      button: {
        videoOwnerRenderer?: {
          thumbnail: {
            thumbnails: Array<{
              url: string
              width: number
              height: number
            }>
          }
          title: {
            runs: Array<{
              text: string
            }>
          }
          navigationEndpoint: {
            clickTrackingParams: string
            openPopupAction: {
              popup: {
                overlaySectionRenderer: {
                  dismissalCommand: {
                    clickTrackingParams: string
                    signalAction: {
                      signal: string
                    }
                  }
                  overlay: {
                    overlayTwoPanelRenderer: {
                      actionPanel: {
                        overlayPanelRenderer: {
                          header: {
                            overlayPanelHeaderRenderer: {
                              image: {
                                thumbnails: Array<{
                                  url: string
                                  width: number
                                  height: number
                                }>
                              }
                              title: {
                                simpleText: string
                              }
                              subtitle: {
                                simpleText: string
                              }
                              style: string
                            }
                          }
                          content: {
                            overlayPanelItemListRenderer: {
                              items: Array<{
                                compactLinkRenderer?: {
                                  title: {
                                    simpleText: string
                                  }
                                  navigationEndpoint: {
                                    clickTrackingParams: string
                                    commandExecutorCommand: {
                                      commands: Array<{
                                        clickTrackingParams: string
                                        signalAction?: {
                                          signal: string
                                        }
                                        browseEndpoint?: {
                                          browseId: string
                                          canonicalBaseUrl: string
                                        }
                                      }>
                                    }
                                  }
                                  trackingParams: string
                                }
                                subscribeButtonRenderer?: {
                                  buttonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  subscribed: boolean
                                  enabled: boolean
                                  type: string
                                  channelId: string
                                  showPreferences: boolean
                                  subscribedButtonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  unsubscribedButtonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  trackingParams: string
                                  unsubscribeButtonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  serviceEndpoints: Array<{
                                    clickTrackingParams: string
                                    authDeterminedCommand?: {
                                      authenticatedCommand: {
                                        clickTrackingParams: string
                                        subscribeEndpoint: {
                                          channelIds: Array<string>
                                          params: string
                                        }
                                      }
                                      unauthenticatedCommand: {
                                        clickTrackingParams: string
                                        authRequiredCommand: {
                                          identityActionContext: {
                                            eventTrigger: string
                                            nextEndpoint: {
                                              clickTrackingParams: string
                                              commandExecutorCommand: {
                                                commands: Array<{
                                                  clickTrackingParams: string
                                                  signalAction?: {
                                                    signal: string
                                                  }
                                                  subscribeEndpoint?: {
                                                    channelIds: Array<string>
                                                    params: string
                                                  }
                                                }>
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                    unsubscribeEndpoint?: {
                                      channelIds: Array<string>
                                      params: string
                                    }
                                  }>
                                  notificationPreferenceButton: {
                                    subscriptionNotificationToggleButtonRenderer: {
                                      states: Array<{
                                        stateId: number
                                        nextStateId: number
                                        state: {
                                          buttonRenderer: {
                                            style: string
                                            size: string
                                            isDisabled: boolean
                                            icon: {
                                              iconType: string
                                            }
                                            accessibility: {
                                              label: string
                                            }
                                            trackingParams: string
                                            accessibilityData: {
                                              accessibilityData: {
                                                label: string
                                              }
                                            }
                                          }
                                        }
                                        inlineMenuButton: {
                                          buttonRenderer: {
                                            style: string
                                            size: string
                                            isDisabled: boolean
                                            text: {
                                              simpleText: string
                                            }
                                            serviceEndpoint: {
                                              clickTrackingParams: string
                                              modifyChannelNotificationPreferenceEndpoint: {
                                                params: string
                                              }
                                            }
                                            icon: {
                                              iconType: string
                                            }
                                            trackingParams: string
                                          }
                                        }
                                        notificationState: string
                                      }>
                                      currentStateId: number
                                      trackingParams: string
                                      onTapBehavior: string
                                      command: {
                                        clickTrackingParams: string
                                        openPopupAction: {
                                          popup: {
                                            overlaySectionRenderer: {
                                              dismissalCommand: {
                                                clickTrackingParams: string
                                                signalAction: {
                                                  signal: string
                                                }
                                              }
                                              overlay: {
                                                overlayTwoPanelRenderer: {
                                                  actionPanel: {
                                                    overlayPanelRenderer: {
                                                      header: {
                                                        overlayPanelHeaderRenderer: {
                                                          title: {
                                                            runs: Array<{
                                                              text: string
                                                            }>
                                                          }
                                                          subtitle: {
                                                            runs: Array<{
                                                              text: string
                                                            }>
                                                          }
                                                        }
                                                      }
                                                      content: {
                                                        overlayPanelItemListRenderer: {
                                                          items: Array<{
                                                            subscriptionNotificationToggleButtonRenderer: {
                                                              states: Array<{
                                                                stateId: number
                                                                nextStateId: number
                                                                state: {
                                                                  buttonRenderer: {
                                                                    style: string
                                                                    size: string
                                                                    isDisabled: boolean
                                                                    icon: {
                                                                      iconType: string
                                                                    }
                                                                    accessibility: {
                                                                      label: string
                                                                    }
                                                                    trackingParams: string
                                                                    accessibilityData: {
                                                                      accessibilityData: {
                                                                        label: string
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                                inlineMenuButton: {
                                                                  buttonRenderer: {
                                                                    style: string
                                                                    size: string
                                                                    isDisabled: boolean
                                                                    text: {
                                                                      simpleText: string
                                                                    }
                                                                    serviceEndpoint: {
                                                                      clickTrackingParams: string
                                                                      modifyChannelNotificationPreferenceEndpoint: {
                                                                        params: string
                                                                      }
                                                                    }
                                                                    icon: {
                                                                      iconType: string
                                                                    }
                                                                    trackingParams: string
                                                                  }
                                                                }
                                                                notificationState: string
                                                              }>
                                                              currentStateId: number
                                                              trackingParams: string
                                                              onTapBehavior: string
                                                              command: {
                                                                clickTrackingParams: string
                                                                openPopupAction: {
                                                                  popup: {
                                                                    overlaySectionRenderer: {
                                                                      dismissalCommand: {
                                                                        clickTrackingParams: string
                                                                        signalAction: {
                                                                          signal: string
                                                                        }
                                                                      }
                                                                      overlay: {
                                                                        overlayTwoPanelRenderer: {
                                                                          actionPanel: {
                                                                            overlayPanelRenderer: {
                                                                              header: {
                                                                                overlayPanelHeaderRenderer: {
                                                                                  title: {
                                                                                    runs: Array<{
                                                                                      text: string
                                                                                    }>
                                                                                  }
                                                                                }
                                                                              }
                                                                              content: {
                                                                                overlayPanelItemListRenderer: {}
                                                                              }
                                                                              trackingParams: string
                                                                            }
                                                                          }
                                                                          backButton: {
                                                                            buttonRenderer: {
                                                                              icon: {
                                                                                iconType: string
                                                                              }
                                                                              trackingParams: string
                                                                              command: {
                                                                                clickTrackingParams: string
                                                                                signalAction: {
                                                                                  signal: string
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                      trackingParams: string
                                                                    }
                                                                  }
                                                                  popupType: string
                                                                  replacePopup: boolean
                                                                }
                                                              }
                                                              targetId: string
                                                              notificationStateEntityKey: string
                                                              notificationsLabel: {
                                                                runs: Array<{
                                                                  text: string
                                                                }>
                                                              }
                                                            }
                                                          }>
                                                        }
                                                      }
                                                      trackingParams: string
                                                    }
                                                  }
                                                  backButton: {
                                                    buttonRenderer: {
                                                      icon: {
                                                        iconType: string
                                                      }
                                                      trackingParams: string
                                                      command: {
                                                        clickTrackingParams: string
                                                        signalAction: {
                                                          signal: string
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                              trackingParams: string
                                            }
                                          }
                                          popupType: string
                                          replacePopup: boolean
                                        }
                                      }
                                      targetId: string
                                      notificationStateEntityKey: string
                                      notificationsLabel: {
                                        runs: Array<{
                                          text: string
                                        }>
                                      }
                                    }
                                  }
                                  subscribedEntityKey: string
                                }
                              }>
                            }
                          }
                          trackingParams: string
                        }
                      }
                      backButton: {
                        buttonRenderer: {
                          icon: {
                            iconType: string
                          }
                          trackingParams: string
                          command: {
                            clickTrackingParams: string
                            signalAction: {
                              signal: string
                            }
                          }
                        }
                      }
                    }
                  }
                  trackingParams: string
                }
              }
              popupType: string
              replacePopup: boolean
            }
          }
          trackingParams: string
        }
        toggleButtonRenderer?: {
          isToggled: boolean
          isDisabled: boolean
          defaultIcon: {
            iconType: string
          }
          defaultText: {
            runs?: Array<{
              text: string
            }>
            simpleText?: string
          }
          defaultServiceEndpoint: {
            clickTrackingParams: string
            setClientSettingEndpoint?: {
              settingDatas: Array<{
                clientSettingEnum: {
                  item: string
                }
                boolValue: boolean
              }>
            }
            authDeterminedCommand?: {
              authenticatedCommand: {
                clickTrackingParams: string
                likeEndpoint: {
                  status: string
                  target: {
                    videoId: string
                  }
                  dislikeParams?: string
                  likeParams?: string
                }
              }
              unauthenticatedCommand: {
                clickTrackingParams: string
                authRequiredCommand: {
                  identityActionContext: {
                    eventTrigger: string
                    nextEndpoint: {
                      clickTrackingParams: string
                      commandExecutorCommand: {
                        commands: Array<{
                          clickTrackingParams: string
                          signalAction?: {
                            signal: string
                          }
                          likeEndpoint?: {
                            status: string
                            target: {
                              videoId: string
                            }
                            dislikeParams?: string
                            likeParams?: string
                          }
                        }>
                      }
                    }
                  }
                }
              }
            }
            selectSubtitlesTrackCommand?: {
              useDefaultTrack: boolean
            }
          }
          toggledIcon?: {
            iconType: string
          }
          toggledText: {
            runs?: Array<{
              text: string
            }>
            simpleText?: string
          }
          toggledServiceEndpoint: {
            clickTrackingParams: string
            setClientSettingEndpoint?: {
              settingDatas: Array<{
                clientSettingEnum: {
                  item: string
                }
                boolValue: boolean
              }>
            }
            authDeterminedCommand?: {
              authenticatedCommand: {
                clickTrackingParams: string
                likeEndpoint: {
                  status: string
                  target: {
                    videoId: string
                  }
                  removeLikeParams: string
                }
              }
              unauthenticatedCommand: {
                clickTrackingParams: string
                authRequiredCommand: {
                  identityActionContext: {
                    eventTrigger: string
                    nextEndpoint: {
                      clickTrackingParams: string
                      commandExecutorCommand: {
                        commands: Array<{
                          clickTrackingParams: string
                          signalAction?: {
                            signal: string
                          }
                          likeEndpoint?: {
                            status: string
                            target: {
                              videoId: string
                            }
                            removeLikeParams: string
                          }
                        }>
                      }
                    }
                  }
                }
              }
            }
            selectSubtitlesTrackCommand?: {}
          }
          trackingParams: string
          accessibility?: {
            label: string
          }
          defaultTooltip?: string
          toggledTooltip?: string
          accessibilityData?: {
            accessibilityData: {
              label: string
            }
          }
          targetId?: string
        }
        buttonRenderer?: {
          isDisabled: boolean
          text: {
            runs: Array<{
              text: string
            }>
          }
          icon: {
            iconType: string
          }
          trackingParams: string
          command: {
            clickTrackingParams: string
            openClientOverlayAction?: {
              type: string
              context?: string
            }
            signalAction?: {
              signal: string
            }
            authDeterminedCommand?: {
              authenticatedCommand: {
                clickTrackingParams: string
                openClientOverlayAction: {
                  type: string
                  context?: string
                }
              }
              unauthenticatedCommand: {
                clickTrackingParams: string
                authRequiredCommand: {
                  identityActionContext: {
                    eventTrigger: string
                    nextEndpoint: {
                      clickTrackingParams: string
                      commandExecutorCommand: {
                        commands: Array<{
                          clickTrackingParams: string
                          signalAction?: {
                            signal: string
                          }
                          openClientOverlayAction?: {
                            type: string
                            context?: string
                          }
                        }>
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }>
  }
  adHoverTextButtonRenderer: {}
  focused: boolean
  isHidden: boolean
  ib: boolean
  liveStreamOfflineSlateRenderer: any
  isAudioOnlyPlayback: boolean
  isAudioOnlyPlaybackBlockedByRights: boolean
  playbackContentMode: string
  U3: boolean
  Va: boolean
  BZ: boolean
}

export type TransportControlsState = {
  TU: {
    buttons: Array<{
      type: string
      button: {
        videoOwnerRenderer?: {
          thumbnail: {
            thumbnails: Array<{
              url: string
              width: number
              height: number
            }>
          }
          title: {
            runs: Array<{
              text: string
            }>
          }
          navigationEndpoint: {
            clickTrackingParams: string
            openPopupAction: {
              popup: {
                overlaySectionRenderer: {
                  dismissalCommand: {
                    clickTrackingParams: string
                    signalAction: {
                      signal: string
                    }
                  }
                  overlay: {
                    overlayTwoPanelRenderer: {
                      actionPanel: {
                        overlayPanelRenderer: {
                          header: {
                            overlayPanelHeaderRenderer: {
                              image: {
                                thumbnails: Array<{
                                  url: string
                                  width: number
                                  height: number
                                }>
                              }
                              title: {
                                simpleText: string
                              }
                              subtitle: {
                                simpleText: string
                              }
                              style: string
                            }
                          }
                          content: {
                            overlayPanelItemListRenderer: {
                              items: Array<{
                                compactLinkRenderer?: {
                                  title: {
                                    simpleText: string
                                  }
                                  navigationEndpoint: {
                                    clickTrackingParams: string
                                    commandExecutorCommand: {
                                      commands: Array<{
                                        clickTrackingParams: string
                                        signalAction?: {
                                          signal: string
                                        }
                                        browseEndpoint?: {
                                          browseId: string
                                          canonicalBaseUrl: string
                                        }
                                      }>
                                    }
                                  }
                                  trackingParams: string
                                }
                                subscribeButtonRenderer?: {
                                  buttonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  subscribed: boolean
                                  enabled: boolean
                                  type: string
                                  channelId: string
                                  showPreferences: boolean
                                  subscribedButtonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  unsubscribedButtonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  trackingParams: string
                                  unsubscribeButtonText: {
                                    runs: Array<{
                                      text: string
                                    }>
                                  }
                                  serviceEndpoints: Array<{
                                    clickTrackingParams: string
                                    authDeterminedCommand?: {
                                      authenticatedCommand: {
                                        clickTrackingParams: string
                                        subscribeEndpoint: {
                                          channelIds: Array<string>
                                          params: string
                                        }
                                      }
                                      unauthenticatedCommand: {
                                        clickTrackingParams: string
                                        authRequiredCommand: {
                                          identityActionContext: {
                                            eventTrigger: string
                                            nextEndpoint: {
                                              clickTrackingParams: string
                                              commandExecutorCommand: {
                                                commands: Array<{
                                                  clickTrackingParams: string
                                                  signalAction?: {
                                                    signal: string
                                                  }
                                                  subscribeEndpoint?: {
                                                    channelIds: Array<string>
                                                    params: string
                                                  }
                                                }>
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                    unsubscribeEndpoint?: {
                                      channelIds: Array<string>
                                      params: string
                                    }
                                  }>
                                  notificationPreferenceButton: {
                                    subscriptionNotificationToggleButtonRenderer: {
                                      states: Array<{
                                        stateId: number
                                        nextStateId: number
                                        state: {
                                          buttonRenderer: {
                                            style: string
                                            size: string
                                            isDisabled: boolean
                                            icon: {
                                              iconType: string
                                            }
                                            accessibility: {
                                              label: string
                                            }
                                            trackingParams: string
                                            accessibilityData: {
                                              accessibilityData: {
                                                label: string
                                              }
                                            }
                                          }
                                        }
                                        inlineMenuButton: {
                                          buttonRenderer: {
                                            style: string
                                            size: string
                                            isDisabled: boolean
                                            text: {
                                              simpleText: string
                                            }
                                            serviceEndpoint: {
                                              clickTrackingParams: string
                                              modifyChannelNotificationPreferenceEndpoint: {
                                                params: string
                                              }
                                            }
                                            icon: {
                                              iconType: string
                                            }
                                            trackingParams: string
                                          }
                                        }
                                        notificationState: string
                                      }>
                                      currentStateId: number
                                      trackingParams: string
                                      onTapBehavior: string
                                      command: {
                                        clickTrackingParams: string
                                        openPopupAction: {
                                          popup: {
                                            overlaySectionRenderer: {
                                              dismissalCommand: {
                                                clickTrackingParams: string
                                                signalAction: {
                                                  signal: string
                                                }
                                              }
                                              overlay: {
                                                overlayTwoPanelRenderer: {
                                                  actionPanel: {
                                                    overlayPanelRenderer: {
                                                      header: {
                                                        overlayPanelHeaderRenderer: {
                                                          title: {
                                                            runs: Array<{
                                                              text: string
                                                            }>
                                                          }
                                                          subtitle: {
                                                            runs: Array<{
                                                              text: string
                                                            }>
                                                          }
                                                        }
                                                      }
                                                      content: {
                                                        overlayPanelItemListRenderer: {
                                                          items: Array<{
                                                            subscriptionNotificationToggleButtonRenderer: {
                                                              states: Array<{
                                                                stateId: number
                                                                nextStateId: number
                                                                state: {
                                                                  buttonRenderer: {
                                                                    style: string
                                                                    size: string
                                                                    isDisabled: boolean
                                                                    icon: {
                                                                      iconType: string
                                                                    }
                                                                    accessibility: {
                                                                      label: string
                                                                    }
                                                                    trackingParams: string
                                                                    accessibilityData: {
                                                                      accessibilityData: {
                                                                        label: string
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                                inlineMenuButton: {
                                                                  buttonRenderer: {
                                                                    style: string
                                                                    size: string
                                                                    isDisabled: boolean
                                                                    text: {
                                                                      simpleText: string
                                                                    }
                                                                    serviceEndpoint: {
                                                                      clickTrackingParams: string
                                                                      modifyChannelNotificationPreferenceEndpoint: {
                                                                        params: string
                                                                      }
                                                                    }
                                                                    icon: {
                                                                      iconType: string
                                                                    }
                                                                    trackingParams: string
                                                                  }
                                                                }
                                                                notificationState: string
                                                              }>
                                                              currentStateId: number
                                                              trackingParams: string
                                                              onTapBehavior: string
                                                              command: {
                                                                clickTrackingParams: string
                                                                openPopupAction: {
                                                                  popup: {
                                                                    overlaySectionRenderer: {
                                                                      dismissalCommand: {
                                                                        clickTrackingParams: string
                                                                        signalAction: {
                                                                          signal: string
                                                                        }
                                                                      }
                                                                      overlay: {
                                                                        overlayTwoPanelRenderer: {
                                                                          actionPanel: {
                                                                            overlayPanelRenderer: {
                                                                              header: {
                                                                                overlayPanelHeaderRenderer: {
                                                                                  title: {
                                                                                    runs: Array<{
                                                                                      text: string
                                                                                    }>
                                                                                  }
                                                                                }
                                                                              }
                                                                              content: {
                                                                                overlayPanelItemListRenderer: {}
                                                                              }
                                                                              trackingParams: string
                                                                            }
                                                                          }
                                                                          backButton: {
                                                                            buttonRenderer: {
                                                                              icon: {
                                                                                iconType: string
                                                                              }
                                                                              trackingParams: string
                                                                              command: {
                                                                                clickTrackingParams: string
                                                                                signalAction: {
                                                                                  signal: string
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                      trackingParams: string
                                                                    }
                                                                  }
                                                                  popupType: string
                                                                  replacePopup: boolean
                                                                }
                                                              }
                                                              targetId: string
                                                              notificationStateEntityKey: string
                                                              notificationsLabel: {
                                                                runs: Array<{
                                                                  text: string
                                                                }>
                                                              }
                                                            }
                                                          }>
                                                        }
                                                      }
                                                      trackingParams: string
                                                    }
                                                  }
                                                  backButton: {
                                                    buttonRenderer: {
                                                      icon: {
                                                        iconType: string
                                                      }
                                                      trackingParams: string
                                                      command: {
                                                        clickTrackingParams: string
                                                        signalAction: {
                                                          signal: string
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                              trackingParams: string
                                            }
                                          }
                                          popupType: string
                                          replacePopup: boolean
                                        }
                                      }
                                      targetId: string
                                      notificationStateEntityKey: string
                                      notificationsLabel: {
                                        runs: Array<{
                                          text: string
                                        }>
                                      }
                                    }
                                  }
                                  subscribedEntityKey: string
                                }
                              }>
                            }
                          }
                          trackingParams: string
                        }
                      }
                      backButton: {
                        buttonRenderer: {
                          icon: {
                            iconType: string
                          }
                          trackingParams: string
                          command: {
                            clickTrackingParams: string
                            signalAction: {
                              signal: string
                            }
                          }
                        }
                      }
                    }
                  }
                  trackingParams: string
                }
              }
              popupType: string
              replacePopup: boolean
            }
          }
          trackingParams: string
        }
        toggleButtonRenderer?: {
          isToggled: boolean
          isDisabled: boolean
          defaultIcon: {
            iconType: string
          }
          defaultText: {
            runs?: Array<{
              text: string
            }>
            simpleText?: string
          }
          defaultServiceEndpoint: {
            clickTrackingParams: string
            setClientSettingEndpoint?: {
              settingDatas: Array<{
                clientSettingEnum: {
                  item: string
                }
                boolValue: boolean
              }>
            }
            authDeterminedCommand?: {
              authenticatedCommand: {
                clickTrackingParams: string
                likeEndpoint: {
                  status: string
                  target: {
                    videoId: string
                  }
                  dislikeParams?: string
                  likeParams?: string
                }
              }
              unauthenticatedCommand: {
                clickTrackingParams: string
                authRequiredCommand: {
                  identityActionContext: {
                    eventTrigger: string
                    nextEndpoint: {
                      clickTrackingParams: string
                      commandExecutorCommand: {
                        commands: Array<{
                          clickTrackingParams: string
                          signalAction?: {
                            signal: string
                          }
                          likeEndpoint?: {
                            status: string
                            target: {
                              videoId: string
                            }
                            dislikeParams?: string
                            likeParams?: string
                          }
                        }>
                      }
                    }
                  }
                }
              }
            }
            selectSubtitlesTrackCommand?: {
              useDefaultTrack: boolean
            }
          }
          toggledIcon?: {
            iconType: string
          }
          toggledText: {
            runs?: Array<{
              text: string
            }>
            simpleText?: string
          }
          toggledServiceEndpoint: {
            clickTrackingParams: string
            setClientSettingEndpoint?: {
              settingDatas: Array<{
                clientSettingEnum: {
                  item: string
                }
                boolValue: boolean
              }>
            }
            authDeterminedCommand?: {
              authenticatedCommand: {
                clickTrackingParams: string
                likeEndpoint: {
                  status: string
                  target: {
                    videoId: string
                  }
                  removeLikeParams: string
                }
              }
              unauthenticatedCommand: {
                clickTrackingParams: string
                authRequiredCommand: {
                  identityActionContext: {
                    eventTrigger: string
                    nextEndpoint: {
                      clickTrackingParams: string
                      commandExecutorCommand: {
                        commands: Array<{
                          clickTrackingParams: string
                          signalAction?: {
                            signal: string
                          }
                          likeEndpoint?: {
                            status: string
                            target: {
                              videoId: string
                            }
                            removeLikeParams: string
                          }
                        }>
                      }
                    }
                  }
                }
              }
            }
            selectSubtitlesTrackCommand?: {}
          }
          trackingParams: string
          accessibility?: {
            label: string
          }
          defaultTooltip?: string
          toggledTooltip?: string
          accessibilityData?: {
            accessibilityData: {
              label: string
            }
          }
          targetId?: string
        }
        buttonRenderer?: {
          isDisabled: boolean
          text: {
            runs: Array<{
              text: string
            }>
          }
          icon: {
            iconType: string
          }
          trackingParams: string
          command: {
            clickTrackingParams: string
            openClientOverlayAction?: {
              type: string
              context?: string
            }
            signalAction?: {
              signal: string
            }
            authDeterminedCommand?: {
              authenticatedCommand: {
                clickTrackingParams: string
                openClientOverlayAction: {
                  type: string
                  context?: string
                }
              }
              unauthenticatedCommand: {
                clickTrackingParams: string
                authRequiredCommand: {
                  identityActionContext: {
                    eventTrigger: string
                    nextEndpoint: {
                      clickTrackingParams: string
                      commandExecutorCommand: {
                        commands: Array<{
                          clickTrackingParams: string
                          signalAction?: {
                            signal: string
                          }
                          openClientOverlayAction?: {
                            type: string
                            context?: string
                          }
                        }>
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }>
  }
  primaryButtons: Array<{
    renderer: {
      videoOwnerRenderer?: {
        thumbnail: {
          thumbnails: Array<{
            url: string
            width: number
            height: number
          }>
        }
        title: {
          runs: Array<{
            text: string
          }>
        }
        navigationEndpoint: {
          clickTrackingParams: string
          openPopupAction: {
            popup: {
              overlaySectionRenderer: {
                dismissalCommand: {
                  clickTrackingParams: string
                  signalAction: {
                    signal: string
                  }
                }
                overlay: {
                  overlayTwoPanelRenderer: {
                    actionPanel: {
                      overlayPanelRenderer: {
                        header: {
                          overlayPanelHeaderRenderer: {
                            image: {
                              thumbnails: Array<{
                                url: string
                                width: number
                                height: number
                              }>
                            }
                            title: {
                              simpleText: string
                            }
                            subtitle: {
                              simpleText: string
                            }
                            style: string
                          }
                        }
                        content: {
                          overlayPanelItemListRenderer: {
                            items: Array<{
                              compactLinkRenderer?: {
                                title: {
                                  simpleText: string
                                }
                                navigationEndpoint: {
                                  clickTrackingParams: string
                                  commandExecutorCommand: {
                                    commands: Array<{
                                      clickTrackingParams: string
                                      signalAction?: {
                                        signal: string
                                      }
                                      browseEndpoint?: {
                                        browseId: string
                                        canonicalBaseUrl: string
                                      }
                                    }>
                                  }
                                }
                                trackingParams: string
                              }
                              subscribeButtonRenderer?: {
                                buttonText: {
                                  runs: Array<{
                                    text: string
                                  }>
                                }
                                subscribed: boolean
                                enabled: boolean
                                type: string
                                channelId: string
                                showPreferences: boolean
                                subscribedButtonText: {
                                  runs: Array<{
                                    text: string
                                  }>
                                }
                                unsubscribedButtonText: {
                                  runs: Array<{
                                    text: string
                                  }>
                                }
                                trackingParams: string
                                unsubscribeButtonText: {
                                  runs: Array<{
                                    text: string
                                  }>
                                }
                                serviceEndpoints: Array<{
                                  clickTrackingParams: string
                                  authDeterminedCommand?: {
                                    authenticatedCommand: {
                                      clickTrackingParams: string
                                      subscribeEndpoint: {
                                        channelIds: Array<string>
                                        params: string
                                      }
                                    }
                                    unauthenticatedCommand: {
                                      clickTrackingParams: string
                                      authRequiredCommand: {
                                        identityActionContext: {
                                          eventTrigger: string
                                          nextEndpoint: {
                                            clickTrackingParams: string
                                            commandExecutorCommand: {
                                              commands: Array<{
                                                clickTrackingParams: string
                                                signalAction?: {
                                                  signal: string
                                                }
                                                subscribeEndpoint?: {
                                                  channelIds: Array<string>
                                                  params: string
                                                }
                                              }>
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                  unsubscribeEndpoint?: {
                                    channelIds: Array<string>
                                    params: string
                                  }
                                }>
                                notificationPreferenceButton: {
                                  subscriptionNotificationToggleButtonRenderer: {
                                    states: Array<{
                                      stateId: number
                                      nextStateId: number
                                      state: {
                                        buttonRenderer: {
                                          style: string
                                          size: string
                                          isDisabled: boolean
                                          icon: {
                                            iconType: string
                                          }
                                          accessibility: {
                                            label: string
                                          }
                                          trackingParams: string
                                          accessibilityData: {
                                            accessibilityData: {
                                              label: string
                                            }
                                          }
                                        }
                                      }
                                      inlineMenuButton: {
                                        buttonRenderer: {
                                          style: string
                                          size: string
                                          isDisabled: boolean
                                          text: {
                                            simpleText: string
                                          }
                                          serviceEndpoint: {
                                            clickTrackingParams: string
                                            modifyChannelNotificationPreferenceEndpoint: {
                                              params: string
                                            }
                                          }
                                          icon: {
                                            iconType: string
                                          }
                                          trackingParams: string
                                        }
                                      }
                                      notificationState: string
                                    }>
                                    currentStateId: number
                                    trackingParams: string
                                    onTapBehavior: string
                                    command: {
                                      clickTrackingParams: string
                                      openPopupAction: {
                                        popup: {
                                          overlaySectionRenderer: {
                                            dismissalCommand: {
                                              clickTrackingParams: string
                                              signalAction: {
                                                signal: string
                                              }
                                            }
                                            overlay: {
                                              overlayTwoPanelRenderer: {
                                                actionPanel: {
                                                  overlayPanelRenderer: {
                                                    header: {
                                                      overlayPanelHeaderRenderer: {
                                                        title: {
                                                          runs: Array<{
                                                            text: string
                                                          }>
                                                        }
                                                        subtitle: {
                                                          runs: Array<{
                                                            text: string
                                                          }>
                                                        }
                                                      }
                                                    }
                                                    content: {
                                                      overlayPanelItemListRenderer: {
                                                        items: Array<{
                                                          subscriptionNotificationToggleButtonRenderer: {
                                                            states: Array<{
                                                              stateId: number
                                                              nextStateId: number
                                                              state: {
                                                                buttonRenderer: {
                                                                  style: string
                                                                  size: string
                                                                  isDisabled: boolean
                                                                  icon: {
                                                                    iconType: string
                                                                  }
                                                                  accessibility: {
                                                                    label: string
                                                                  }
                                                                  trackingParams: string
                                                                  accessibilityData: {
                                                                    accessibilityData: {
                                                                      label: string
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                              inlineMenuButton: {
                                                                buttonRenderer: {
                                                                  style: string
                                                                  size: string
                                                                  isDisabled: boolean
                                                                  text: {
                                                                    simpleText: string
                                                                  }
                                                                  serviceEndpoint: {
                                                                    clickTrackingParams: string
                                                                    modifyChannelNotificationPreferenceEndpoint: {
                                                                      params: string
                                                                    }
                                                                  }
                                                                  icon: {
                                                                    iconType: string
                                                                  }
                                                                  trackingParams: string
                                                                }
                                                              }
                                                              notificationState: string
                                                            }>
                                                            currentStateId: number
                                                            trackingParams: string
                                                            onTapBehavior: string
                                                            command: {
                                                              clickTrackingParams: string
                                                              openPopupAction: {
                                                                popup: {
                                                                  overlaySectionRenderer: {
                                                                    dismissalCommand: {
                                                                      clickTrackingParams: string
                                                                      signalAction: {
                                                                        signal: string
                                                                      }
                                                                    }
                                                                    overlay: {
                                                                      overlayTwoPanelRenderer: {
                                                                        actionPanel: {
                                                                          overlayPanelRenderer: {
                                                                            header: {
                                                                              overlayPanelHeaderRenderer: {
                                                                                title: {
                                                                                  runs: Array<{
                                                                                    text: string
                                                                                  }>
                                                                                }
                                                                              }
                                                                            }
                                                                            content: {
                                                                              overlayPanelItemListRenderer: {}
                                                                            }
                                                                            trackingParams: string
                                                                          }
                                                                        }
                                                                        backButton: {
                                                                          buttonRenderer: {
                                                                            icon: {
                                                                              iconType: string
                                                                            }
                                                                            trackingParams: string
                                                                            command: {
                                                                              clickTrackingParams: string
                                                                              signalAction: {
                                                                                signal: string
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                    trackingParams: string
                                                                  }
                                                                }
                                                                popupType: string
                                                                replacePopup: boolean
                                                              }
                                                            }
                                                            targetId: string
                                                            notificationStateEntityKey: string
                                                            notificationsLabel: {
                                                              runs: Array<{
                                                                text: string
                                                              }>
                                                            }
                                                          }
                                                        }>
                                                      }
                                                    }
                                                    trackingParams: string
                                                  }
                                                }
                                                backButton: {
                                                  buttonRenderer: {
                                                    icon: {
                                                      iconType: string
                                                    }
                                                    trackingParams: string
                                                    command: {
                                                      clickTrackingParams: string
                                                      signalAction: {
                                                        signal: string
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                            trackingParams: string
                                          }
                                        }
                                        popupType: string
                                        replacePopup: boolean
                                      }
                                    }
                                    targetId: string
                                    notificationStateEntityKey: string
                                    notificationsLabel: {
                                      runs: Array<{
                                        text: string
                                      }>
                                    }
                                  }
                                }
                                subscribedEntityKey: string
                              }
                            }>
                          }
                        }
                        trackingParams: string
                      }
                    }
                    backButton: {
                      buttonRenderer: {
                        icon: {
                          iconType: string
                        }
                        trackingParams: string
                        command: {
                          clickTrackingParams: string
                          signalAction: {
                            signal: string
                          }
                        }
                      }
                    }
                  }
                }
                trackingParams: string
              }
            }
            popupType: string
            replacePopup: boolean
          }
        }
        trackingParams: string
      }
      toggleButtonRenderer?: {
        isToggled: boolean
        isDisabled: boolean
        defaultIcon: {
          iconType: string
        }
        defaultText: {
          simpleText?: string
          runs?: Array<{
            text: string
          }>
        }
        defaultServiceEndpoint: {
          clickTrackingParams: string
          authDeterminedCommand?: {
            authenticatedCommand: {
              clickTrackingParams: string
              likeEndpoint: {
                status: string
                target: {
                  videoId: string
                }
                dislikeParams?: string
                likeParams?: string
              }
            }
            unauthenticatedCommand: {
              clickTrackingParams: string
              authRequiredCommand: {
                identityActionContext: {
                  eventTrigger: string
                  nextEndpoint: {
                    clickTrackingParams: string
                    commandExecutorCommand: {
                      commands: Array<{
                        clickTrackingParams: string
                        signalAction?: {
                          signal: string
                        }
                        likeEndpoint?: {
                          status: string
                          target: {
                            videoId: string
                          }
                          dislikeParams?: string
                          likeParams?: string
                        }
                      }>
                    }
                  }
                }
              }
            }
          }
          selectSubtitlesTrackCommand?: {
            useDefaultTrack: boolean
          }
        }
        toggledIcon?: {
          iconType: string
        }
        toggledText: {
          simpleText?: string
          runs?: Array<{
            text: string
          }>
        }
        toggledServiceEndpoint: {
          clickTrackingParams: string
          authDeterminedCommand?: {
            authenticatedCommand: {
              clickTrackingParams: string
              likeEndpoint: {
                status: string
                target: {
                  videoId: string
                }
                removeLikeParams: string
              }
            }
            unauthenticatedCommand: {
              clickTrackingParams: string
              authRequiredCommand: {
                identityActionContext: {
                  eventTrigger: string
                  nextEndpoint: {
                    clickTrackingParams: string
                    commandExecutorCommand: {
                      commands: Array<{
                        clickTrackingParams: string
                        signalAction?: {
                          signal: string
                        }
                        likeEndpoint?: {
                          status: string
                          target: {
                            videoId: string
                          }
                          removeLikeParams: string
                        }
                      }>
                    }
                  }
                }
              }
            }
          }
          selectSubtitlesTrackCommand?: {}
        }
        accessibility?: {
          label: string
        }
        trackingParams: string
        defaultTooltip?: string
        toggledTooltip?: string
        accessibilityData?: {
          accessibilityData: {
            label: string
          }
        }
        targetId?: string
      }
      buttonRenderer?: {
        isDisabled: boolean
        text: {
          runs: Array<{
            text: string
          }>
        }
        icon: {
          iconType: string
        }
        trackingParams: string
        command: {
          clickTrackingParams: string
          openClientOverlayAction?: {
            type: string
          }
          authDeterminedCommand?: {
            authenticatedCommand: {
              clickTrackingParams: string
              openClientOverlayAction: {
                type: string
                context: string
              }
            }
            unauthenticatedCommand: {
              clickTrackingParams: string
              authRequiredCommand: {
                identityActionContext: {
                  eventTrigger: string
                  nextEndpoint: {
                    clickTrackingParams: string
                    commandExecutorCommand: {
                      commands: Array<{
                        clickTrackingParams: string
                        signalAction?: {
                          signal: string
                        }
                        openClientOverlayAction?: {
                          type: string
                          context: string
                        }
                      }>
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    idomKey: string
  }>
  selectedIndex: number
  lc: any
  isUpcoming: boolean
}


export type TransportControlsInstance = {
  __instance: {
    props: TransportControlsProps;
    state: TransportControlsState;
  }
}

export type SettingButton = {
  type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS'
  button: {
    buttonRenderer: {
      isDisabled: boolean
      text: {
        runs: Array<{
          text: string
        }>
      }
      icon: {
        iconType: string
      }
      trackingParams: string
      command: {
        clickTrackingParams: string
        openClientOverlayAction: {
          type: string
        }
      }
    }
  }
}
