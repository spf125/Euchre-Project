$(document).ready(function () {
    let currentPlayerIndex = 0;
    let playerOrder = [];
    let currentSuit = "";
    let trumpSelected = false;
    let gameResponse = null;
    let kitty = [] // Store the global response object here

    // Reset Current Trump and Game Score on Page Load
    $("#current-trump").text("None");
    $("#game-score").text("Player Team: 0 | Opponent Team: 0");
    
    // Initialize Semantic UI checkbox
    $('.ui.toggle.checkbox').checkbox();

    // Map cards to their positions
    const positions = {
        "Player": "#human-card",
        "Opponent1": "#bot1-card",
        "Team Mate": "#bot2-card",
        "Opponent2": "#bot3-card",
    };

    const tableSlots = {
        "Player": "#table-slot-player",
        "Opponent1": "#table-slot-bot1",
        "Team Mate": "#table-slot-bot2",
        "Opponent2": "#table-slot-bot3",
    };

    function removeCardFromHand(player, card) {
        const handSelector = positions[player];
        // Use attribute match on data-card; for bots, data-card holds the real card string
        $(handSelector).find(`img.playing-card[data-card='${card}']`).remove();
    }

    function placeCardOnTable(player, card) {
        const slotSelector = tableSlots[player];
        const $slot = $(slotSelector);
        if ($slot.length) {
            const imgSrc = getCardImage(card);
            // Replace existing card for that player’s slot (only one visible per trick)
            $slot.empty().append(`<img src="${imgSrc}" class="played-card" data-card="${card}" data-player="${player}">`);
        }
    }

    function clearTableSlots() {
        Object.values(tableSlots).forEach(selector => $(selector).empty());
    }
    
    // Update revealPlayedCard to both remove from hand and place on table
    function revealPlayedCard(player, card) {
        removeCardFromHand(player, card);
        placeCardOnTable(player, card);
    }

    function getCardImage(card) {
        if (card === "Hidden") {
            return "/static/images/cards/back.png"; // Back of the card
        }
        let cardParts = card.split(" of "); // Extract rank and suit
        let rank = cardParts[0];
        let suit = cardParts[1];
        return `/static/images/cards/${rank}_of_${suit}.png`;
    }
    
    function displayDealtCards(response) {
        for (let player in response.hands) {
            const cardContainer = $(positions[player]);
            cardContainer.empty(); // Clear previous cards
    
            response.hands[player].forEach((card, index) => {
                let imgSrc = player === "Player" ? getCardImage(card) : getCardImage("Hidden");
                cardContainer.append(`<img src="${imgSrc}" class="playing-card" data-card="${card}" data-player="${player}">`);
            });
        }
    }

    function showTrumpSelection(dealer) {
        console.log("🃏 Showing Trump Selection Dialog...");
    
        $("#modal-trump .modal-content").html(`
            <p>The dealer is <strong>${dealer}</strong>. Decide the trump suit.</p>
        `);
    
        // Hide unnecessary buttons
        $("#accept-trump-button, #reject-trump-button, .suit-button").show();
        $("#ok-trump-button, #restart-trump-button").hide();
    
        $("#modal-trump").show(); // Show the modal
    }

    function showRoundModal(message, phase = "start") {
        $("#modal-round .modal-content").html(`<p>${message}</p>`);
    
        if (phase === "start") {
            $("#modal-round-button").show();  // Show Start Round button
            $("#ok-round-button").hide();
            $("#end-game-button").hide();
        } else if (phase === "results") {
            $("#modal-round-button").hide();
            $("#ok-round-button").show();  // Show OK button to close results
            $("#end-game-button").hide();
        } else if (phase === "end") {
            $("#modal-round-button").hide();
            $("#ok-round-button").hide();
            $("#end-game-button").show();  // Show End Game button if game is over
        }
    
        $("#modal-round").fadeIn();
    }
    
    

    function displayHighCards(response) {
        // Display the dealt high cards
        for (let player in response.dealt_cards) {
            const cardContainer = $(positions[player]);
            cardContainer.empty(); // Clear previous cards
            let highcard = response.dealt_cards[player];
            //console.log(highcard)
            let imgSrc = getCardImage(highcard);
            cardContainer.append(`<img src="${imgSrc}" class="playing-card" data-card="${highcard}" data-player="${player}">`);
        }
    }

    // function revealPlayedCard(player, card) {
    //     let imgSrc = getCardImage(card);
    //     $(positions[player]).find(`[data-card='${card}']`).attr("src", imgSrc);
    // }

    // Function to display the trump card modal
    function showTrumpCardDialog(card, player) {
        $("#start-game-button").hide();
        $("#start-game-form").hide();
        $("#ok-round-button").hide();
        $("#modal-round").hide();
        $("#modal-dealer").hide();
        $("#reject-trump-button").show();
        $("#accept-trump-button").show();
        $(".suit-button").hide();
        $("#going-alone-checkbox").show();
        $("#going-alone-checkbox").prop("checked", false);
        $("#modal-trump .modal-content").html(`
            <img src="${getCardImage(card)}" class="playing-card" style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%);" alt="Up Card">
        `);

        $("#reject-trump-button").prop("disabled", false);
    
        // Ensure buttons are properly assigned new handlers
        $("#accept-trump-button").off("click").on("click", function () {
            const goingAlone = $("#going-alone-checkbox").is(":checked");
            $("#modal-trump").fadeOut(); // Hide the modal before proceeding
            acceptTrump(player, card, 1, goingAlone);
        });
    
        $("#reject-trump-button").off("click").on("click", function () {
            $("#modal-trump").fadeOut(); // Hide modal before moving to the next player
            rejectTrump(player, 1);
        });
    
        $("#modal-trump").fadeIn(); // Ensure modal appears properly
    }    
    
    // Function to display the trump card modal for the 2nd round of trump selection
    function showTrumpCardDialog2ndRound(upCardSuit, player) {
        $("#start-game-button").hide();
        $("#ok-round-button").hide();
        $("#modal-round").fadeOut();
        $("#modal-dealer").fadeOut();
        $("#reject-trump-button").show();
        $("#accept-trump-button").hide();
        $(".suit-button").show();
        $("#going-alone-checkbox").show();
        $("#going-alone-checkbox").prop("checked", false);
        $("#modal-trump .modal-content").html(`
        `);

        // Enable all suit buttons
        $(".suit-button").prop("disabled", false);
        $("#reject-trump-button").prop("disabled", false);

        // Disable the button for the upcard suit
        $(`.suit-button[data-suit="${upCardSuit}"]`).prop("disabled", true);

        // Disable the pass button if player is the dealer
        if (player === gameResponse.dealer) {
            $("#reject-trump-button").prop("disabled", true);
        }

        $(".suit-button").off("click").on("click", function () {
            const selectedSuit = $(this).data("suit");
            const goingAlone = $("#going-alone-checkbox").is(":checked");
            $("#modal-trump").fadeOut(); // Hide the modal before proceeding
            acceptTrump(player, selectedSuit, 2, goingAlone);
        });

        $("#reject-trump-button").off("click").on("click", function () {
            $("#modal-trump").fadeOut();
            rejectTrump(player, 2);
        });

        $("#modal-trump").fadeIn(); // Ensure modal appears properly
    }    

    function acceptTrump(player, card, trumpRound, goingAlone) {
        const data = { trump_round: trumpRound};

        if (trumpRound === 1) {
            if (gameResponse.remaining_cards.includes(card)) {
                data.card = card;
            } else {
                console.error(`❌ Error: The selected trump card (${card}) is not in remaining cards.`);
                return;
            }
        } else if (trumpRound === 2) {
            data.suit = card;
        }        
        trumpRound = 1; // Reset the trump round to 1 after accepting trump

        $.ajax({
            url: "/accept-trump/",
            type: "POST",
            data: data,
            success: function (response) {
                trumpSelected = true;
                currentSuit = response.trump_suit;
                dealer = response.dealer;

                // Update and display the kitty after the dealer picks up and discards
                kitty[0].faceup = false;
                if (response.discarded_card) {
                    kitty[0].card = response.discarded_card;
                }
                updateKittyDisplay();
                
                // Sync dealer hand in UI for both human and bot
                if (response.dealer_updated_hand && Array.isArray(response.dealer_updated_hand)) {
                    const dealerName = response.dealer.trim();
                    const containerSel = positions[dealerName];
                    const $container = $(containerSel);
                    if ($container.length) {
                        $container.empty();
                        response.dealer_updated_hand.forEach((c) => {
                            const imgSrc = dealerName === "Player" ? getCardImage(c) : getCardImage("Hidden");
                            // data-card MUST be the real card
                            $container.append(`<img src="${imgSrc}" class="playing-card" data-card="${c}" data-player="${dealerName}">`);
                        });
                    }
                }

                // If dealer is bot and we re-sorted player's hand, sync player's UI too
                if (response.player_updated_hand && Array.isArray(response.player_updated_hand)) {
                    updatePlayerHand("Player", response.player_updated_hand);
                }

                // UI: trump icon, caller badge
                updateTrumpDisplay(currentSuit);
                updatePlayerNames(player, currentSuit);

                // Hide trump modal and show round start confirmation
                $("#modal-trump").fadeOut();
                message = goingAlone 
                    ? `${player} is <b>going alone</b> in ${currentSuit}.`
                    : `${player} called trump! The trump suit is now ${currentSuit}.`
                showRoundStart(message, player, goingAlone);
            },
            error: function (xhr) {
                alert("Error accepting trump: " + xhr.responseText);
            }
        });
    }

    function updatePlayerNames(trumpCaller = null, trumpSuit = null) {
        $(".rectangle").removeClass("loner-partner");
        
        $(".center-top-text").text("Team Mate");
        $(".center-left-text").text("Opponent 1");
        $(".center-bottom-text").text("Player");
        $(".center-right-text").text("Opponent 2");

        // Add indicator to the player who called trump
        if (trumpCaller) {
            const nameMap = {
                "Player": ".center-bottom-text",
                "Opponent1": ".center-left-text",
                "Team Mate": ".center-top-text",
                "Opponent2": ".center-right-text"
            }

            const suitImageMap = {
                "spades": "/static/images/spade.png",
                "hearts": "/static/images/heart.png",
                "diamonds": "/static/images/diamond.png",
                "clubs": "/static/images/club.png"
            }
            
            const selector = nameMap[trumpCaller];
            const baseText = $(selector).text();
            if (selector.includes("center-left-text") || selector.includes("center-right-text")) {
                $(selector).html(`${baseText} <img src="${suitImageMap[trumpSuit]}" alt="${trumpSuit}" class="trump-caller-indicator ${selector === ".center-right-text" ? "right-indicator" : "left-indicator"}">`);
            } else {
                $(selector).html(`${baseText} <img src="${suitImageMap[trumpSuit]}" alt="${trumpSuit}" class="trump-caller-indicator">`);
            }
        }
    }

    function updatePlayerHand(player, cards) {
        const cardContainer = $(positions["Player"]);
        cardContainer.empty(); // Clear previous cards

        cards.forEach(card => {
            let imgSrc = player === "Player" ? getCardImage(card) : getCardImage("Hidden");
            cardContainer.append(`<img src="${imgSrc}" class="playing-card" data-card="${card}" data-player="${player}">`);
        });
    }
    
    function rejectTrump(player, trumpRound) {
        currentPlayerIndex++;
    
        if (currentPlayerIndex < playerOrder.length) {
            if (trumpRound === 1) {
                setTimeout(() => {
                    if (playerOrder[currentPlayerIndex].is_human == true) {
                        showTrumpCardDialog(gameResponse.remaining_cards[0], playerOrder[currentPlayerIndex].name);
                    } else {
                        determineBotTrumpDecision(playerOrder[currentPlayerIndex].name, gameResponse.remaining_cards[0], trumpRound, playerOrder);
                    }
                }, 400); // Delay prevents modal flickering
            } else if (trumpRound === 2) {
                setTimeout(() => {
                    if (playerOrder[currentPlayerIndex].is_human == true) {
                        showTrumpCardDialog2ndRound(gameResponse.remaining_cards[0].split(" of ")[1], playerOrder[currentPlayerIndex].name);
                    } else {
                        determineBotTrumpDecision(playerOrder[currentPlayerIndex].name, gameResponse.remaining_cards[0], trumpRound, playerOrder);
                    }
                }, 400); // Delay prevents modal flickering
            }
        } else {
            // Everyone passed in first round, so start second round
            trumpRound = 2;
            currentPlayerIndex = 0;

            // Update kitty
            kitty[0].faceup = false;
            
            updateKittyDisplay();
            
            // Give trump dialog box, but this time player can select any suit except for the upCardSuit
            setTimeout(() => {
                if (playerOrder[currentPlayerIndex].is_human == true) {
                    showTrumpCardDialog2ndRound(gameResponse.remaining_cards[0].split(" of ")[1], playerOrder[currentPlayerIndex].name);
                } else {
                    determineBotTrumpDecision(playerOrder[currentPlayerIndex].name, gameResponse.remaining_cards[0], trumpRound, playerOrder);
                }
            }, 400);
        }
    }

    function determineBotTrumpDecision(player, upCard, trumpRound, playerOrder) {
        $.ajax({
            url: "/determine-trump/",
            type: "POST",
            data: {
                player: player,
                dealer: dealer,
                up_card: upCard,
                trump_round: trumpRound,
                player_order: JSON.stringify(playerOrder)
            },
            async: false,
            success: function (response) {
                const botDecision = response.decision;
                const goingAlone = response.going_alone;
                console.log("Bot decision:", botDecision);

                if (trumpRound === 1) {
                    if (botDecision === 'pass') {
                        $("#bot-messages").text(`${player} passes`).fadeIn().delay(400).fadeOut();
                        setTimeout(() => {
                            rejectTrump(player, trumpRound);
                        }, 800);
                    } else {
                        acceptTrump(player, upCard, trumpRound, goingAlone);
                    }
                } else if (trumpRound === 2) {
                    if (botDecision === 'pass') {
                        $("#bot-messages").text(`${player} passes`).fadeIn().delay(400).fadeOut();
                        setTimeout(() => {
                            rejectTrump(player, trumpRound);
                        }, 800);
                    } else {
                        acceptTrump(player, botDecision, trumpRound, goingAlone);
                    }
                }
            },
            error: function (xhr) {
                alert("Error determining bot decision: " + xhr.responseText);
            }
        });
    }

    // Function to display the final message before round starts
    function showFinalMessage(message) {
        $("#modal-trump .modal-content").html(`
            <p>${message}</p>
        `);
    
        // Hide unnecessary buttons
        $("#accept-trump-button").hide();
        $("#reject-trump-button").hide();
        $("#ok-modal-button").hide();
        $("#modal-round-button").hide();
        $("#ok-trump-button").show();  // Ensure OK button is visible
    
        $("#modal-trump").fadeIn(); // Ensure modal is visible
    }

    // Function to display the round status
    function showRoundStart(message, trumpCaller, goingAlone) {
        if (!trumpSelected) return;  // Prevents round modal from appearing too early

        $("#modal-trump").fadeOut(); // Hide trump modal if still visible
        $("#modal-round .modal-content").html(`
            <p>${message}</p>
        `);
    
        $("#modal-round-button").show();
        $("#modal-round").fadeIn();

        // Hide unnecessary buttons
        $("#accept-trump-button").hide();
        $("#reject-trump-button").hide();
        $("#ok-modal-button").hide();
        $("#ok-round-button").hide();
        $("#ok-trump-button").hide();
        $("#modal-round-button").show();

        if (goingAlone) {
            updateHandForLoner(trumpCaller, goingAlone);
        }

        $("#modal-round-button").off("click").on("click", function () {
            $("#modal-round").fadeOut();
            startRound(trumpCaller, goingAlone);
        });

        $("#modal-round").fadeIn(); // Ensure round modal is displayed
    }

    function updateHandForLoner(trumpCaller, goingAlone) {
        const partnerMap = {
            "Player": "Team Mate",
            "Opponent1": "Opponent2",
            "Opponent2": "Opponent1",
            "Team Mate": "Player"
        };

        const partner = partnerMap[trumpCaller];
        $(positions[partner]).addClass("loner-partner");
    }
    

    // Start the game
    $("#start-game-button").click(function () {

        // Hide the start game button
        $("#start-game-button").hide();
        $("#start-game-form").hide();

        $.ajax({
            url: "/start-game/", // Matches the URL in urls.py
            type: "POST",
            success: function (response) {
                console.log("New dealer is:", response.dealer); // Debugging log
            
                // ✅ Ensure dealer is highlighted and icon is added on first round
                $(".rectangle").removeClass("dealer-highlight").find(".dealer-icon").remove();
            
                if (response.dealer && positions[response.dealer]) {
                    const dealerPosition = positions[response.dealer];
                
                    console.log(`✅ Updating dealer to: ${response.dealer}`);
                
                    $(dealerPosition).addClass("dealer-highlight");
                
                    // ✅ Only add the dealer icon if it's missing
                    if ($(dealerPosition).find(".dealer-icon").length === 0) {
                        $(dealerPosition).prepend(`
                            <img src="/static/images/dealer-icon.png" alt="Dealer Icon" class="dealer-icon">
                        `);
                    }
                }
                 else {
                    console.error("❌ Error: Dealer position not found in UI during game start.");
                }
            
                initializeDealerModal(response);
                displayHighCards(response); // Ensure high cards are shown
                playerOrder = response.player_order; // Set player order for trump selection
            },
            error: function (xhr) {
                alert("An error occurred: " + xhr.responseText);
            }
        });
    });

    // Deal cards after selecting the dealer
    $("#modal-ok-button").click(function () {
        $("#modal-dealer").fadeOut();
    
        // Deal 5 cards to each player
        $.ajax({
            url: "/deal-hand/",
            type: "POST",
            data: { dealer: dealer },
            success: function (response) {
                gameResponse = response;
                playerOrder = response.player_order;
                currentPlayerIndex = 0;

                updateTrumpDisplay(null);
    
                initializeKitty(response.remaining_cards);
                displayDealtCards(response);
    
                // ✅ Ensure the dealer highlight and icon remain
                $(".rectangle").removeClass("dealer-highlight").find(".dealer-icon").remove();
    
                if (dealer in positions) {
                    const dealerPosition = positions[dealer];
                    $(dealerPosition).addClass("dealer-highlight");
                    if ($(dealerPosition).find(".dealer-icon").length === 0) {
                        $(dealerPosition).prepend(`
                            <img src="/static/images/dealer-icon.png" alt="Dealer Icon" class="dealer-icon">
                        `);
                    }
                }

                // Start the trump card selection process
                if (playerOrder[currentPlayerIndex].is_human == true) {
                    showTrumpCardDialog(response.remaining_cards[0], playerOrder[currentPlayerIndex].name);
                } else {
                    determineBotTrumpDecision(playerOrder[currentPlayerIndex].name, gameResponse.remaining_cards[0], 1, playerOrder);
                }
            },
            error: function (xhr) {
                alert("An error occurred while dealing the hand: " + xhr.responseText);
            }
        });
    });    

    function initializeKitty(remainingCards) {
        console.log("Initializing kitty with:", remainingCards);
        kitty = remainingCards.map((card, index) => {
            return {
                card: card,
                faceup: index === 0
            }
        });
        updateKittyDisplay();
    }

    function updateKittyDisplay() {
        const container = document.getElementById("remaining-cards-list");
        container.innerHTML = "";

        console.log("kitty: ", kitty)

        kitty.forEach(item => {
            const cardSrc = item.faceup ? getCardImage(item.card) : getCardImage("Hidden");

            container.innerHTML += `
                <img class="playing-card" src="${cardSrc}" data-card="${item.card}">
            `;
        });

        // Create a grid container
        container.innerHTML = `
            <div class="kitty-grid">
                <div class="kitty-row">
                    <img class="playing-card" src="${kitty[0].faceup ? getCardImage(kitty[0].card) : getCardImage("Hidden")}" data-card="${kitty[0].card}">
                    <img class="playing-card" src="${kitty[1].faceup ? getCardImage(kitty[1].card) : getCardImage("Hidden")}" data-card="${kitty[1].card}">
                    <img class="playing-card" src="${kitty[2].faceup ? getCardImage(kitty[2].card) : getCardImage("Hidden")}" data-card="${kitty[2].card}">
                    <img class="playing-card" src="${kitty[3].faceup ? getCardImage(kitty[3].card) : getCardImage("Hidden")}" data-card="${kitty[3].card}">
                </div>
            </div>
        `;

    }

    function initializeDealerModal(response) {
        dealer = response.dealer;
        $("#modal-dealer .modal-content").html(`
            <p><strong>Highest Card:</strong> ${response.highest_card}</p>
            <p><strong>Dealer:</strong> ${response.dealer}</p>
        `);
        $("#modal-dealer").fadeIn();
    }

    // Handle rejecting the trump card
    $("#reject-trump-button").click(function () {
        currentPlayerIndex++;
        if (currentPlayerIndex <= 3) {
            if (playerOrder[currentPlayerIndex].is_human == true) {
                showTrumpCardDialog(gameResponse.remaining_cards[0], playerOrder[currentPlayerIndex].name);
            } else {
                determineBotTrumpDecision(playerOrder[currentPlayerIndex].name, gameResponse.remaining_cards[0], 1, playerOrder);
            }
        } else {
            showFinalMessage("No one accepted the trump card.");
            trumpSelected = false;
        }
    });

    // Function to reset the UI when trump selection starts
    function resetPlayerHandBeforeTrump() {
        $("#player-hand").empty(); // Clear displayed cards to prevent double-counting
    }

    function updateTrumpDisplay(suit) {
        const tooltipIconHTML = `
            <div class="tooltip-label">
                <strong>Current Trump</strong>
                <img src="/static/images/tooltip.png"
                    alt="Tooltip"
                    class="tooltip-icon"
                    data-tooltip-id="trump">
            </div>`;
    
        if (!suit) {
            $(".bottom-left-column-1").html(`
                ${tooltipIconHTML}
                <div class="icon-wrapper">
                    <img src="/static/images/card_suits.png" alt="Select Trump" class="trump-suit-icon">
                </div>
            `);
        } else {
            const suitImageMap = {
                "spades": "/static/images/spade.png",
                "hearts": "/static/images/heart.png",
                "diamonds": "/static/images/diamond.png",
                "clubs": "/static/images/club.png"
            };
            const suitImagePath = suitImageMap[suit];
    
            $(".bottom-left-column-1").html(`
                ${tooltipIconHTML}
                <div class="icon-wrapper">
                    <img src="${suitImagePath}" alt="${suit}" class="trump-suit-icon">
                </div>
            `);
        }
    
        // 🔁 Bind click behavior
        $(".tooltip-icon").off("click").on("click", function () {
            const tooltipId = $(this).data("tooltip-id");
            const message = tooltips[tooltipId] || "Tooltip not found.";
            $("#tooltip-content").html(message);
            $("#tooltip-modal").modal("show");
        });
    
        // 👀 Show or hide based on tooltipsEnabled
        if (window.tooltipsEnabled === false) {
            $(".tooltip-icon").hide();
        } else {
            $(".tooltip-icon").show();
        }
    }


    // Handle the OK button to close the trump card modal and open the round start model
    $("#ok-trump-button").click(function () {
        $("#modal-trump").fadeOut();
        $("#mok-trump-button").hide();
        $("#modal-round").fadeIn();
        if (trumpSelected) {
            showRoundStart(`Trump suit for round: ${currentSuit}!`);
        } else {
            showRoundStart("The first card played will set the trump suit.");
        }
    });    

    // Function to display human player's hand as clickable buttons
    // function displayHumanHand(cards) {
    //     $("#player-hand").empty();

    //     cards.forEach(card => {
    //         let cardButton = `<button class="card-btn" data-card="${card}">${card}</button>`;
    //         $("#player-hand").append(cardButton);
    //     });

    //     // When player clicks a card, send to backend
    //     $(".card-btn").click(function () {
    //         let selectedCard = $(this).attr("data-card");
    //         playSelectedCard(selectedCard);
    //     });
    // }
    
    // // After dealing hands, show player's hand
    // $.ajax({
    //     url: "/deal-hand/",
    //     type: "POST",
    //     success: function (response) {
    //         if (response.hands && response.hands["Player"]) {
    //             displayHumanHand(response.hands["Player"]); // Show player's hand
    //         }
    //     }
    // });

    // Function to show the round results modal
    function showRoundResults(results) {
        let winningMessage = results.winning_team
            ? `<p><strong>${results.winning_team} won the game!</strong></p>`
            : ``;

        // Update game score display
        updateGameScore(results.team1_points, results.team2_points);

        // Remove trump suit icon
        $("#current-trump").text("None");
    
        $("#modal-round .modal-content").html(`
            <p><strong>Round Completed!</strong></p>
            ${winningMessage}
        `);
    
        $("#modal-round-button").hide(); // Hide Start Round button
    
        if (results.winning_team) {
            $("#ok-round-button").hide();
            $("#end-game-button").show();  // Show End Game button
        } else {
            $("#ok-round-button").show();
            $("#end-game-button").hide();
        }
    
        $("#modal-round").fadeIn();  // Ensure modal is displayed
    }
    

    // Handle starting the round
    /* Have to redo this to allow player to play individual cards. This will involve:
     * 1. Figuring out when the player's turn is
     * 2. Simulating bot turns in between
     * 3. Updating the UI after each card is played
     * 4. Determining when the round is over
     * 5. Somehow allowing player to select cards from their hand to play
     * 6. Only allow valid plays based on current suit
     
    This means this function will need to be rewritten significantly.
    Will have to:
        1. Start a loop that continues until all tricks are played
        2. In each iteration, determine whose turn it is
        3. If it's the player's turn, wait for them to select a card
        4. If it's a bot's turn, simulate their play by calling the backend determine_best_card function
     */
    function startRound(trumpCaller, goingAlone) {
        console.log(`🔄 Starting round. Trump caller: ${trumpCaller}`);

        const roundState = {
            trickNumber: 1,
            tricks: [],
            currentLeader: null,
            playOrder: [],
            goingAlone: !!goingAlone,
            trumpCaller
        }

        $.ajax({
            url: "/init-trick/",
            type: "POST",
            data: { going_alone: roundState.goingAlone, trump_caller: roundState.trumpCaller },
            success: function (response) {
                if (response.error) {
                    alert("❌ Error: " + response.error);
                    return;
                }
                roundState.currentLeader = response.leader;
                roundState.playOrder = response.play_order;

                playTrick(roundState);
            },
            error: function (xhr) {
                alert("Error initializing trick: " + xhr.responseText);
            }
        });


        // $.ajax({
        //     url: "/start-round/",
        //     type: "POST",
        //     data: { trump_caller: trumpCaller, going_alone: goingAlone },
        //     success: function (response) {
        //         console.log("✅ Round Results Received:", response);

        //         if (response.error) {
        //             alert("❌ Error: " + response.error);
        //             return;
        //         }

        //         if (response.tricks) {
        //             updatePreviousTricks(response.tricks);  // Update all tricks at once
        //         }

        //         if (response.round_results) {
        //             finalizeRound(response);
        //         }

        //         // updateRemainingCards(); // Refresh remaining cards
        //         revealKitty(); // Reveal the kitty since round is over
        //     },
        //     error: function (xhr) {
        //         alert("❌ Error starting round: " + xhr.responseText);
        //     }
        // });
    }

    function playTrick(roundState) {
        const { trickNumber, playOrder } = roundState;
        console.log(`Trick ${trickNumber} starting. Leader: ${roundState.currentLeader}, order: ${playOrder}`);

        const trickContext = {
            number: trickNumber,
            cards: [],
            players: playOrder.slice()
        };

            // Tunable delays (ms)
        const BOT_PLAY_DELAY = 600;       // delay before each bot plays
        const TRICK_PAUSE_DELAY = 900;    // pause after 4 cards before next trick
        const ROUND_PAUSE_DELAY = 1200;   // pause before showing round results

        function enablePlayerTurn() {
            $("#player-hand img.playing-card, #human-card img.playing-card")
                .css("cursor", "pointer")
                .off("click")
                .on("click", function () {
                    const selectedCard = $(this).data("card");
                    console.log(`Player selected card: ${selectedCard}`);
                    playPlayerCard(selectedCard);
                });
        }

        function disablePlayerTurn() {
            $("#player-hand img.playing-card, #human-card img.playing-card")
                .css("cursor", "default")
                .off("click");
        }

        function playPlayerCard(card) {
            disablePlayerTurn();
            $.ajax({
                url: "/play-player-card/",
                type: "POST",
                data: {
                    trick_number: trickContext.number,
                    selected_card: card,
                    current_cards: JSON.stringify(trickContext.cards.map(c => c.card))
                },
                success: function (response) {
                    if (response.error) {
                        alert("Error: " + response.error);
                        enablePlayerTurn(); // Re-enable player turn on error
                        return;
                    }
                    trickContext.cards.push({ player: "Player", card: response.played_card });
                    revealPlayedCard("Player", response.played_card);
                    nextTurn();
                },
                error: function (xhr) {
                    alert("Error playing card: " + xhr.responseText);
                    enablePlayerTurn(); // Re-enable player turn on error
                }
            });
        }

        function playBotTurn(botName) {
            setTimeout(() => {
                $.ajax({
                    url: "/play-bot-card/",
                    type: "POST",
                    data: {
                        trick_number: trickContext.number,
                        bot: botName,
                        current_cards: JSON.stringify(trickContext.cards.map(c => c.card)),
                        current_players: JSON.stringify(trickContext.players),
                        previous_tricks: JSON.stringify(roundState.tricks),
                        trump_caller: roundState.trumpCaller,
                        going_alone: roundState.goingAlone
                    },
                    success: function (response) {
                        if (response.error) {
                            alert("Error: " + response.error);
                            return;
                        }
                        trickContext.cards.push({ player: botName, card: response.played_card });
                        revealPlayedCard(botName, response.played_card);
                        nextTurn();
                    },
                    error: function (xhr) {
                        alert("Error playing bot card: " + xhr.responseText);
                    }
                });
            }, BOT_PLAY_DELAY);
        }

        let turnIndex =  trickContext.players.indexOf(roundState.currentLeader);

        function nextTurn() {
            turnIndex++;
            if (turnIndex >= trickContext.players.length) {
                setTimeout(() => {
                    $.ajax({
                        url: "/resolve-trick/",
                        type: "POST",
                        data: {
                            trick_number: trickContext.number,
                            cards: JSON.stringify(trickContext.cards.map(c => c.card)),
                            players: JSON.stringify(trickContext.players)
                        },
                        success: function (response) {
                            if (response.error) {
                                alert("Error: " + response.error);
                                return;
                            }

                            const trickResult = {
                                trick_number: trickContext.number,
                                players: trickContext.cards.map(c => c.player),
                                cards: trickContext.cards.map(c => c.card),
                                winner: response.winner
                            }

                            roundState.tricks.push(trickResult);
                            updatePreviousTricks([trickResult]); // Update the UI with the completed trick
                            
                            clearTableSlots();

                            roundState.currentLeader = response.winner;

                            // If 5 tricks played, finalize round
                            if (roundState.trickNumber >= 5) {
                                setTimeout(() => finalizeRound(roundState), ROUND_PAUSE_DELAY);
                                return;
                            }

                            setTimeout(() => {
                                roundState.trickNumber += 1;
                                roundState.playOrder = response.next_play_order;
                                playTrick(roundState);
                            }, TRICK_PAUSE_DELAY);
                        },
                        error: function (xhr) {
                            alert("Error resolving trick: " + xhr.responseText);
                        }
                    });
                }, TRICK_PAUSE_DELAY);
                return;
            }

            const currentPlayer = trickContext.players[turnIndex];
            if (currentPlayer === "Player") {
                enablePlayerTurn();
            } else {
                playBotTurn(currentPlayer);
            }
        }

        turnIndex--;
        nextTurn();
    }

    function finalizeRound(roundState) {
        $.ajax({
            url: "/finalize-round/",
            type: "POST",
            data: {
                tricks: JSON.stringify(roundState.tricks),
                trump_caller: roundState.trumpCaller,
                going_alone: roundState.goingAlone
            },
            success: function (response) {
                if (response.error) {
                    alert("Error: " + response.error);
                    return;
                }
                updateGameScore(response.team1_points, response.team2_points);
                showRoundResults({
                    team1_points: response.team1_points,
                    team2_points: response.team2_points,
                    winning_team: response.winning_team
                });
                revealKitty();

                // Clear "Tricks this round" grids to prepare for next round
                document.getElementById("player-teammate-tricks").innerHTML = "";
                document.getElementById("opponent-tricks").innerHTML = "";
                clearTableSlots();
            },
            error: function (xhr) {
                alert("Error finalizing round: " + xhr.responseText);
            }
        });
    }

    function revealKitty() {
        kitty.forEach(item => item.faceup = true);
        updateKittyDisplay();
    }
    
    
    // OK button to close round results modal, and start next round trump selection
    $("#ok-round-button").click(function () {
        $("#modal-round").fadeOut();  // Hide the round results modal
        // dealNextHand(); // ✅ Fix: Ensure trump selection happens first
        // Reset player names to remove trump indicator
        updatePlayerNames();
    
        $.ajax({
            url: "/deal-next-hand/",  // Redeal hands and rotate dealer
            type: "POST",
            success: function (response) {

                gameResponse = response;
                playerOrder = response.player_order;
                currentPlayerIndex = 0;

                updateTrumpDisplay(null);
                
                initializeKitty(response.remaining_cards);
                displayDealtCards(response);
                updateDealerPosition(response);

                // ✅ Show the trump card selection dialog with the first remaining card
                $("#modal-round").fadeOut();
                setTimeout(() => {
                    if (playerOrder[currentPlayerIndex].is_human == true) {
                        showTrumpCardDialog(response.remaining_cards[0], playerOrder[currentPlayerIndex].name);
                    } else {
                        determineBotTrumpDecision(playerOrder[currentPlayerIndex].name, gameResponse.remaining_cards[0], 1, playerOrder);
                    }
                }, 300);  // Adds delay to ensure previous modal fully closes
            }
        }).fail(function(error) {
                console.error("🚨 Error dealing next hand: ", error);
        });
    });
                
                
                // // ✅ Ensure the next round modal is shown
                // $("#modal-round .modal-content").html(`
                //     <p><strong>${response.message}</strong></p>
                //     <p><strong>New Dealer:</strong> ${response.dealer}</p>
                //     <p>Click 'Start Round' to begin.</p>
                // `);
                // $("#modal-round-button").show();
                // $("#modal-round").fadeIn();  // Show the modal for the next round
    
                // // ✅ Ensure 'Start Round' button triggers the next round
                // $("#modal-round-button").off("click").on("click", function () {
                //     $("#modal-round").fadeOut();
                //     startRound(response.dealer);
                // });

    function updateDealerPosition(response) {
        console.log("New dealer is:", response.dealer); // Debugging log
    
        // ✅ Check if the dealer exists in the positions mapping
        console.log("✅ Available positions keys:", Object.keys(positions)); 
        console.log("✅ Received dealer:", response.dealer);
    
        const normalizedDealer = response.dealer.trim();  // Remove extra spaces

        if (!positions[normalizedDealer]) {
            console.error(`❌ Error: No position found for dealer "${normalizedDealer}"`);
            return;  // Exit early to prevent further errors
        }
        
        const dealerPosition = positions[normalizedDealer];
        
        console.log(`✅ Updating dealer to: ${normalizedDealer}`);
        console.log("✅ Dealer position element:", $(dealerPosition)); // Log the actual element
        
        const dealerName = response.dealer.trim();  // Ensure correct dealer name

        if (dealerName in positions) {
            const dealerPosition = positions[dealerName];
        
            // ✅ First, clear only if a valid dealer position exists
            $(".rectangle").removeClass("dealer-highlight").find(".dealer-icon").remove();
        
            $(dealerPosition).addClass("dealer-highlight");
            if ($(dealerPosition).find(".dealer-icon").length === 0) {
                $(dealerPosition).prepend(`
                    <img src="/static/images/dealer-icon.png" alt="Dealer Icon" class="dealer-icon">
                `);
            }
        } else {
            console.error(`❌ Error: No valid dealer position found for "${dealerName}"`);
        }
    }
    


    // End game when one team reaches the points to win
    $("#end-game-button").click(function () {
        $.ajax({
            url: "/reset-game/",  // Reset the game state
            type: "POST",
            success: function (response) {
                console.log(response.message);
                // Reset Current Trump and Game Score on Page Load
                $("#current-trump").text("None");
                $("#game-score").text("Player Team: 0 | Opponent Team: 0");
    
                // Close all modals and reset the UI
                $(".custom-modal").fadeOut();
                $("#remaining-cards-list").html("<p></p>");
                
                updatePlayerNames();

                // Show the Start Game button again
                $("#end-game-button").hide();
                $("#start-game-button").show();
                $("#start-game-form").show();
            },
            error: function (xhr) {
                alert("Error ending the game: " + xhr.responseText);
            }
        });
    });
    

    // Function to update game score
    function updateGameScore(team1, team2) {
        $(".bottom-left-column-2").html(`
            <div class="tooltip-label">
                <strong>Game Score</strong>
                <img src="/static/images/tooltip.png" 
                     alt="Tooltip" 
                     class="tooltip-icon" 
                     data-tooltip-id="score">
            </div>
            <p style="padding-top: 30px; font-size: large;">Player Team: ${team1} points</p>
            <p style="padding-top: 10px; font-size: large;">Opponent Team: ${team2} points</p>
        `);
    
        $(".tooltip-icon").off("click").on("click", function () {
            const tooltipId = $(this).data("tooltip-id");
            const message = tooltips[tooltipId] || "Tooltip not found.";
            $("#tooltip-content").html(message);
            $("#tooltip-modal").modal("show");
        });
    
        // 👀 Respect tooltip toggle state
        if (window.tooltipsEnabled === false) {
            $(".tooltip-icon").hide();
        } else {
            $(".tooltip-icon").show();
        }
    }    

    function updateRemainingCards(showCards=false) {
        const redSuits = ["hearts", "diamonds"]; // First row
        const blackSuits = ["clubs", "spades"]; // Second row
        const suits = [...redSuits, ...blackSuits]; // Full order
        const ranks = ["A", "K", "Q", "J", "10", "9"]; // Descending rank order
    
        // Generate the full deck of 24 cards
        let fullDeck = [];
        suits.forEach(suit => {
            ranks.forEach(rank => {
                fullDeck.push(`${rank} of ${suit}`);
            });
        });
    
        $.ajax({
            url: "/get-remaining-cards/",
            type: "GET",
            success: function (response) {
                if (response.remaining_cards) {
                    // Filter out used cards
                    const usedCards = response.remaining_cards;
                    let availableCards = fullDeck.filter(card => usedCards.includes(card));
    
                    // Sort the available cards: Grouped by suit, descending by rank
                    availableCards.sort((a, b) => {
                        let [rankA, suitA] = a.split(" of ");
                        let [rankB, suitB] = b.split(" of ");
    
                        let suitIndexA = suits.indexOf(suitA);
                        let suitIndexB = suits.indexOf(suitB);
    
                        if (suitIndexA !== suitIndexB) {
                            return suitIndexA - suitIndexB; // Sort by suit order
                        }
                        return ranks.indexOf(rankA) - ranks.indexOf(rankB); // Sort descending within suit
                    });
    
                    // Group cards into two rows
                    let redRowHTML = ""; // Hearts & Diamonds
                    let blackRowHTML = ""; // Clubs & Spades
    
                    availableCards.forEach(card => {
                        let suit = card.split(" of ")[1];
                        let cardHTML = `<img src="${getCardImage(card)}" class="playing-card" data-card="${card}">`;
                        
                        if (redSuits.includes(suit)) {
                            redRowHTML += cardHTML;
                        } else if (blackSuits.includes(suit)) {
                            blackRowHTML += cardHTML;
                        }
                    });
    
                    // Update the UI for remaining cards
                    $("#remaining-cards-list").html(`
                        <div class="card-row">${redRowHTML}</div>
                        <div class="card-row">${blackRowHTML}</div>
                    `);
                } else {
                    $("#remaining-cards-list").html("<p>Error loading remaining cards.</p>");
                }
            },
            error: function (xhr) {
                console.error("Error fetching remaining cards:", xhr.responseText);
                $("#remaining-cards-list").html("<p>Error loading remaining cards.</p>");
            }
        });
    }
    

    function updatePreviousTricks(tricks) {
        let playerTeammateBody = document.getElementById("player-teammate-tricks");
        let opponentBody = document.getElementById("opponent-tricks");
    
        // Do not clear existing rows; append new ones
        tricks.forEach((trick) => {
            const playerName = "Player";
            const opponent1Name = "Opponent1";
            const teammateName = "Team Mate";
            const opponent2Name = "Opponent2";
    
            const idx = (name) => trick.players.indexOf(name);
            const playerCard = idx(playerName) !== -1 ? trick.cards[idx(playerName)] : "";
            const opponent1Card = idx(opponent1Name) !== -1 ? trick.cards[idx(opponent1Name)] : "";
            const teammateCard = idx(teammateName) !== -1 ? trick.cards[idx(teammateName)] : "";
            const opponent2Card = idx(opponent2Name) !== -1 ? trick.cards[idx(opponent2Name)] : "";
    
            let winner = trick.winner;
    
            let playerTeamWinClass = (winner === playerName || winner === teammateName) ? "winner-green" : "";
            let opponentTeamWinClass = (winner === opponent1Name || winner === opponent2Name) ? "winner-red" : "";
    
            const playerRow = `
                <tr>
                    <td>${trick.trick_number}</td>
                    <td>${playerName}</td>
                    <td>${playerCard}</td>
                    <td>${teammateName}</td>
                    <td>${teammateCard}</td>
                    <td class="${playerTeamWinClass}">${winner}</td>
                </tr>
            `;
            playerTeammateBody.insertAdjacentHTML("beforeend", playerRow);
    
            const opponentRow = `
                <tr>
                    <td>${trick.trick_number}</td>
                    <td>${opponent1Name}</td>
                    <td>${opponent1Card}</td>
                    <td>${opponent2Name}</td>
                    <td>${opponent2Card}</td>
                    <td class="${opponentTeamWinClass}">${winner}</td>
                </tr>
            `;
            opponentBody.insertAdjacentHTML("beforeend", opponentRow);
        });
    }  
    
    
    // function finalizeRound(response) {
    //     console.log("🔄 Finalizing round:", response);
    
    //     if (!response.round_results) {
    //         console.error("❌ Error: No round results received!");
    //         return;
    //     }
    
    //     showRoundResults({
    //         "team1_points": response.round_results.team1_points,
    //         "team2_points": response.round_results.team2_points,
    //         "winning_team": response.round_results.winning_team,
    //     });
    
    //     console.log("✅ Round Completed! Displaying results.");
    
    //     // ✅ Ensure the round modal remains visible until the next round starts
    //     $("#modal-round").fadeIn();
    // }
    

    // // Reset the game when the page loads
    // $.ajax({
    //     url: "/reset-game/", // URL for the reset endpoint
    //     type: "POST",
    //     success: function (response) {
    //         console.log(response.message); // Log success message
    //     },
    //     error: function (xhr) {
    //         console.error("An error occurred while resetting the game: " + xhr.responseText);
    //     }
    // });

    // window.addEventListener("beforeunload", function () {
    //     $.ajax({
    //         url: "/reset-game/",
    //         type: "POST",
    //         async: false // Synchronous request to ensure the reset completes
    //     });
    // });
});