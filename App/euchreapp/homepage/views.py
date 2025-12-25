from django.shortcuts import render, redirect
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth import login
from django.contrib.auth.views import LoginView
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from random import shuffle
from .models import start_euchre_round, Game, Player, Card, deal_hand as model_deal_hand, PlayedCard, reset_round_state, Hand, GameResult, rotate_dealer
import json

# Render the homepage
def home(request):
    return render(request, "home.html")  # Reference the template in the root templates directory

# Render the About page
def about(request):
    return render(request, "about.html")

# Signup and view to homepage and save the login information
def signup(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)  # Automatically log in the user after signup
            return redirect('/')  # Redirect to the homepage
    else:
        form = UserCreationForm()
    return render(request, 'signup.html', {'form': form})

# Login redirects to homepage or the admin page if logging as admin
class CustomLoginView(LoginView):
    template_name = 'login.html'  # Use custom template in the root templates directory

    def get_success_url(self):
        # Redirect admin users to the admin site
        if self.request.user.is_staff or self.request.user.is_superuser:
            return '/admin/'
        # Redirect regular users to the default redirect URL
        return super().get_success_url()

@csrf_exempt
def start_new_game(request):
    if request.method == 'POST':
        try:
            print("🔥 Starting a new game while keeping previous data...")

            # Step 1: Mark the last game as completed if unfinished
            last_game = Game.objects.order_by('-id').first()
            if last_game and not GameResult.objects.filter(game=last_game).exists():
                GameResult.objects.create(
                    game=last_game,
                    winner=None,  
                    total_hands=last_game.hands.count(),
                    points={"team1": last_game.team1_points, "team2": last_game.team2_points},
                )
                print(f"✅ Archived last game: {last_game.id}")

            # Step 2: Create a new game
            game = Game.objects.create()

            # Step 3: Reset only the deck for this game
            print("♠️ Creating a fresh deck for the new game...")
            suits = ["hearts", "diamonds", "clubs", "spades"]
            ranks = ["9", "10", "J", "Q", "K", "A"]

            # Only create cards that are not already in the database
            existing_cards = {(card.rank, card.suit) for card in Card.objects.all()}
            new_cards = []

            for suit in suits:
                for rank in ranks:
                    if (rank, suit) not in existing_cards:
                        new_cards.append(Card(suit=suit, rank=rank, is_trump=False))

            # Bulk create to speed up performance
            Card.objects.bulk_create(new_cards)
            print(f"✅ {len(new_cards)} new cards created for the game.")

            # Step 4: Shuffle and assign dealer
            deck = list(Card.objects.all())
            shuffle(deck)

            players = Player.objects.all()
            if len(deck) < len(players):
                return JsonResponse({"error": "Not enough cards to determine dealer."}, status=400)
            
            def is_black_jack(card):
                return card.rank == "J" and card.suit in ("clubs", "spades")
            
            dealer = None
            dealt_log = {}

            deck_index = 0
            while dealer is None:
                for p in players:
                    card = deck[deck_index]
                    deck_index += 1
                    dealt_log[p] = card
                    if is_black_jack(card):
                        dealer = p
                        break

            game.dealer = dealer
            game.save()

            # Step 5: Return cards to deck & shuffle
            Card.objects.all().update(is_trump=False)

            return JsonResponse({
                "dealt_cards": {p.name: f"{c.rank} of {c.suit}" for p, c in dealt_log.items()},
                "dealer": dealer.name,
                "highest_card": f"J of {'spades' if dealt_log[dealer].suit == 'spades' else 'clubs'}",
                "player_order": [p.name for p in players],
                "new_game_id": game.id
            })

        except Exception as e:
            print(f"🚨 ERROR in start_new_game: {str(e)}")
            return JsonResponse({"error": f"🔥 ERROR in start_new_game: {str(e)}"}, status=500)

    return JsonResponse({"error": "Invalid request method."}, status=400)


@csrf_exempt
def deal_next_hand(request):
    """
    Handle resetting everything for subsequent rounds, including:
    - Resetting PlayedCard objects
    - Rotating the dealer to the next player
    - Starting the trump suit selection process
    """
    if request.method == "POST":
        try:
            # Retrieve the latest game
            game = Game.objects.latest('id')

            # Reset round state (This already rotates the dealer)
            deck = reset_round_state(game)

            # ✅ Remove extra dealer rotation
            # The dealer should already be rotated inside `reset_round_state`
            new_dealer = game.dealer

            print(f"✅ New dealer assigned: {new_dealer.name}")

            # Get all players and cards
            players = Player.objects.all()
            
            # Calculate player order starting to the left of the new dealer
            player_list = list(players)
            dealer_index = player_list.index(new_dealer)
            player_order = player_list[dealer_index + 1:] + player_list[:dealer_index + 1]

            # Deal new hands
            hands, remaining_cards = model_deal_hand(deck, players, game)

             # Sort the hands
            for player, cards in hands.items():
                if player.is_human:
                    sorted_cards = sort_hand(cards)
                    hands[player] = sorted_cards

            # Prepare the response with the updated state
            response = {
                "hands": {
                    player.name: [f"{card.rank} of {card.suit}" for card in hand]
                    for player, hand in hands.items()
                },
                "dealer": new_dealer.name.strip(),  # Removes any extra spaces
                "remaining_cards": [f"{card.rank} of {card.suit}" for card in remaining_cards],
                "player_order": [{"name": player.name, "is_human": player.is_human} for player in player_order],
                "message": f"New hands dealt. {new_dealer.name} is now the dealer. Begin trump selection."
            }

            return JsonResponse(response)

        except Exception as e:
            print(f"🚨 Error in deal_next_hand: {str(e)}")
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request method."}, status=400)




@csrf_exempt
def deal_hand(request):
    if request.method == "POST":
        try:
            print("📢 deal_hand() function was called!")

            # Ensure game is initialized or fetch the latest game
            try:
                game = Game.objects.latest('id')
            except Game.DoesNotExist:
                return JsonResponse({"error": "No active game found. Please start a new game first."}, status=400)

            # Shuffle the deck
            deck = list(Card.objects.all())
            shuffle(deck)

            players = Player.objects.all()

            # Calculate player order starting to the left of the dealer
            player_list = list(players)
            dealer_index = player_list.index(game.dealer)
            player_order = player_list[dealer_index + 1:] + player_list[:dealer_index + 1]

            # Debugging: Print deck and player information
            print(f"🔥 DEBUG: Deck contains {len(deck)} cards before dealing.")
            print(f"🔥 DEBUG: Players in game: {[player.name for player in players]}")

            # **Call `model_deal_hand()` and log its output**
            result = model_deal_hand(deck, players, game)

            # If `model_deal_hand()` doesn't return a tuple, fix it
            if not isinstance(result, tuple) or len(result) != 2:
                print(f"🚨 ERROR: Unexpected return value from model_deal_hand(): {result}")
                return JsonResponse({"error": "Unexpected return value from deal_hand(). Check function implementation."}, status=500)

            hands, remaining_cards = result  # This line previously failed

            # Sort the hands
            for player, cards in hands.items():
                if player.is_human:
                    sorted_cards = sort_hand(cards)
                    hands[player] = sorted_cards

            # Prepare the response
            response = {
                "hands": {
                    player.name: [f"{card.rank} of {card.suit}" for card in hand]
                    for player, hand in hands.items()
                },
                "remaining_cards": [f"{card.rank} of {card.suit}" for card in remaining_cards],
                "dealer": game.dealer.name,  # Include the dealer
                "player_order": [{"name": player.name, "is_human": player.is_human} for player in player_order],
                "message": "Hands dealt. Begin trump selection."
            }

            return JsonResponse(response)

        except Exception as e:
            print(f"🚨 ERROR in deal_hand(): {str(e)}")
            return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

    return JsonResponse({"error": "Invalid request method."}, status=400)



@csrf_exempt
def pick_trump(request):
    if request.method == "POST":
        try:
            dealer_name = request.POST.get("dealer")
            players = Player.objects.all()

            # Fetch the remaining cards in their current order
            remaining_cards = list(Card.objects.filter(is_trump=False)[:4])  # Fetch 4 cards as a list
            if not remaining_cards:
                raise ValueError("No remaining cards in the deck for trump selection.")

            # Remove the top card for the next round if rejected
            current_card = remaining_cards.pop(0)  # Get and remove the first card
            player_order = list(players)
            dealer = Player.objects.get(name=dealer_name)

            # Rotate the player order to start with the player left of the dealer
            start_index = (player_order.index(dealer) + 1) % len(player_order)
            player_order = player_order[start_index:] + player_order[:start_index]

            # Update the deck
            remaining_cards_queryset = Card.objects.filter(pk__in=[card.pk for card in remaining_cards])
            Card.objects.exclude(pk__in=remaining_cards_queryset).update(is_trump=False)

            # Return the current card and player order for frontend logic
            response = {
                "current_card": f"{current_card.rank} of {current_card.suit}",
                "player_order": [player.name for player in player_order],
            }
            return JsonResponse(response)
        except Exception as e:
            print(f"Error in pick_trump: {str(e)}")
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request method."}, status=400)


@csrf_exempt
def accept_trump(request):
    if request.method == "POST":
        try:
            trump_round = request.POST.get("trump_round")
            if not trump_round:
                return JsonResponse({"error": "Missing trump round data."}, status=400)

            game = Game.objects.latest('id')
            latest_hand = Hand.objects.filter(game=game).order_by('-id').first()
            if not latest_hand:
                return JsonResponse({"error": "No active hand found for the current game."}, status=400)

            if trump_round == "1":
                card_info = request.POST.get("card")
                if not card_info or " of " not in card_info:
                    return JsonResponse({"error": "Missing or invalid card data."}, status=400)

                r, s = card_info.split(" of ")
                try:
                    up_card = Card.objects.get(rank=r, suit=s)
                except Card.DoesNotExist:
                    return JsonResponse({"error": f"Card '{card_info}' does not exist."}, status=400)

                # Dealer picks up the up card and discards one
                dealer = game.dealer
                dealer_played_qs = PlayedCard.objects.filter(player=dealer, hand=latest_hand).order_by('order')
                dealer_hand_cards = [pc.card for pc in dealer_played_qs]

                # Add up-card to dealer's hand
                dealer_hand_cards.append(up_card)

                # Choose discard based on dealer logic, then remove it from the hand
                discarded_card = dealer.get_worst_card(dealer_hand_cards, up_card.suit)
                dealer_hand_cards.remove(discarded_card)

                # Persist: replace dealer's PlayedCard rows with the new 5-card hand
                dealer_played_qs.delete()

                # Sort dealer hand if human (to match player-view expectations)
                if dealer.is_human:
                    from .views import sort_hand as sort_hand_fn  # reuse helper
                    dealer_hand_cards = sort_hand_fn(dealer_hand_cards, up_card.suit)

                for i, c in enumerate(dealer_hand_cards):
                    PlayedCard.objects.create(
                        player=dealer,
                        card=c,
                        hand=latest_hand,
                        order=i + 1
                    )

                # If dealer is a bot, also sort and re-store the human player's hand for display consistency
                # (keeps Player's hand sorted by new trump)
                if not dealer.is_human:
                    human = Player.objects.get(is_human=True)
                    human_qs = PlayedCard.objects.filter(player=human, hand=latest_hand).order_by('order')
                    human_cards = [pc.card for pc in human_qs]
                    from .views import sort_hand as sort_hand_fn
                    human_sorted = sort_hand_fn(human_cards, up_card.suit)
                    human_qs.delete()
                    for i, c in enumerate(human_sorted):
                        PlayedCard.objects.create(
                            player=human,
                            card=c,
                            hand=latest_hand,
                            order=i + 1
                        )

                # Update game trump
                game.trump_suit = up_card.suit
                game.save()

                # Build response: ALWAYS include dealer’s updated hand for DOM sync
                dealer_updated_hand = [
                    f"{pc.card.rank} of {pc.card.suit}"
                    for pc in PlayedCard.objects.filter(player=dealer, hand=latest_hand).order_by('order')
                ]

                payload = {
                    "trump_suit": up_card.suit,
                    "dealer": dealer.name,
                    "discarded_card": f"{discarded_card.rank} of {discarded_card.suit}",
                    "dealer_updated_hand": dealer_updated_hand
                }

                # Also include player's updated hand if dealer is bot and we re-sorted player
                if not dealer.is_human:
                    human = Player.objects.get(is_human=True)
                    player_updated_hand = [
                        f"{pc.card.rank} of {pc.card.suit}"
                        for pc in PlayedCard.objects.filter(player=human, hand=latest_hand).order_by('order')
                    ]
                    payload["player_updated_hand"] = player_updated_hand

                return JsonResponse(payload)

            # Handle round 2 of trump selection
            elif trump_round == "2":
                suit = request.POST.get("suit")
                if not suit:
                    return JsonResponse({"error": "Missing suit data."}, status=400)
                
                player = Player.objects.get(is_human=True)
                player_cards = PlayedCard.objects.filter(player=player, hand=latest_hand)
                player_hand = [played_card.card for played_card in player_cards]
                sorted_player_hand = sort_hand(player_hand, suit)

                player_cards.delete()

                for i, up_card in enumerate(sorted_player_hand):
                    PlayedCard.objects.create(
                        player=player,
                        card=up_card,
                        hand=latest_hand,
                        order=i + 1
                    )

                # Retrieve updated hand
                updated_hand = [
                    f"{pc.card.rank} of {pc.card.suit}"
                    for pc in PlayedCard.objects.filter(player=player, hand=latest_hand)
                ]
                print(f"Updated hand: {updated_hand}")

                # Update the game's trump suit
                game.trump_suit = suit
                game.save()
                
                return JsonResponse({
                    "trump_suit": suit,
                    "updated_hand": updated_hand
                })
            
            return JsonResponse({"error": "Invalid trump round."}, status=400)

        except Exception as e:
            print(f"Error in accept_trump: {str(e)}")
            return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

    return JsonResponse({"error": "Invalid request method."}, status=400)



@csrf_exempt
def reset_game(request):
    if request.method == "POST":
        try:
            # Archive past games instead of deleting them
            for game in Game.objects.all():
                if not GameResult.objects.filter(game=game).exists():
                    GameResult.objects.create(
                        game=game,
                        winner=None,  # If game was unfinished, set winner as None
                        total_hands=game.hands.count(),
                        points={"team1": game.team1_points, "team2": game.team2_points}
                    )

            # Clear played cards and active hands
            PlayedCard.objects.all().delete()  
            Hand.objects.all().delete()        

            # Reset ongoing games (instead of deleting, clear fields)
            Game.objects.all().update(dealer=None, trump_suit="", team1_points=0, team2_points=0)

            # 🔥 Ensure the deck is fully recreated
            Card.objects.all().delete()  # Ensure no duplicate cards remain

            # Create a fresh deck of unique cards
            for suit, _ in Card.SUITS:
                for rank, _ in Card.RANKS:
                    Card.objects.create(suit=suit, rank=rank, is_trump=False)

            return JsonResponse({"message": "Game reset successfully and archived."})

        except Exception as e:
            return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

    return JsonResponse({"error": "Invalid request method."}, status=400)



@csrf_exempt
def start_round(request):
    """
    Handles starting a new round and plays all 5 tricks at once.
    """
    if request.method == "POST":
        try:
            game = Game.objects.latest('id')
            trump_caller_name = request.POST.get("trump_caller")
            going_alone = request.POST.get("going_alone") == "true"

            try:
                trump_caller = Player.objects.get(name=trump_caller_name)
            except Player.DoesNotExist:
                return JsonResponse({"error": f"Player '{trump_caller_name}' does not exist."}, status=400)

            # Ensure a previous hand exists in the game
            if not game.hands.exists():
                return JsonResponse({"error": "No previous round found. Cannot start a new round."}, status=400)

            # Step 1: Retrieve all players
            players = Player.objects.all()
            player_hands = {player: [] for player in players}

            # Step 2: Get the latest hand for the game
            latest_hand = Hand.objects.filter(game=game).order_by('-id').first()
            if not latest_hand:
                return JsonResponse({"error": "No hand found for the current game!"}, status=400)

            # Step 3: Fetch PlayedCards only for this hand and these players
            unplayed_cards = PlayedCard.objects.filter(hand=latest_hand, player__in=players)

            # Debugging output
            print(f"Before starting round, total PlayedCards: {unplayed_cards.count()}")

            # Step 4: Assign cards to player_hands
            for played_card in unplayed_cards:
                player_hands[played_card.player].append(played_card.card)

            # Debugging: Check card assignments
            for player, cards in player_hands.items():
                print(f"{player.name} has {len(cards)} cards AFTER retrieval.")

            # Ensure all players have enough cards before starting the round
            for player in players:
                player_cards = player_hands[player]
                if len(player_cards) < 5:
                    return JsonResponse({"error": f"{player.name} has {len(player_cards)} cards instead of 5!"}, status=500)

            # Step 5: Play the entire round (all 5 tricks)
            round_result = start_euchre_round(game, trump_caller, going_alone)  # Plays **all 5 tricks**
            
            return round_result  # Returns JSON with full round data

        except Exception as e:
            print(f"Error in start_round: {str(e)}")
            return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

    return JsonResponse({'error': 'Invalid request method'}, status=400)


@csrf_exempt
def get_game_score(request):
    """
    Returns the current game score.
    """
    try:
        game = Game.objects.latest('id')
        return JsonResponse({
            "team1": game.team1_points,
            "team2": game.team2_points
        })
    except Game.DoesNotExist:
        return JsonResponse({"error": "No active game found."}, status=400)
    
@csrf_exempt
def get_remaining_cards(request):
    """
    Returns a list of all remaining (unplayed) cards in the current round.
    """
    try:
        game = Game.objects.latest('id')
        latest_hand = Hand.objects.filter(game=game).order_by('-id').first()

        if not latest_hand:
            return JsonResponse({"error": "No active round found."}, status=400)

        # Get all played cards in this round
        played_cards = PlayedCard.objects.filter(hand__game=game).values_list('card', flat=True)

        # Get all cards that haven't been played, excluding the Player's hand
        player = Player.objects.get(name="Player")  # Adjust if Player's name differs
        player_hand = PlayedCard.objects.filter(player=player, hand=latest_hand).values_list('card', flat=True)

        remaining_cards = Card.objects.exclude(id__in=played_cards).exclude(id__in=player_hand)

        remaining_cards_list = [f"{card.rank} of {card.suit}" for card in remaining_cards]

        return JsonResponse({"remaining_cards": remaining_cards_list})

    except Exception as e:
        print(f"Error in get_remaining_cards: {str(e)}")
        return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

    
@csrf_exempt
def play_next_trick(request):
    """
    Plays the next trick and returns its result.
    """
    if request.method == "POST":
        try:
            game = Game.objects.latest('id')

            # Play the next trick
            response = start_euchre_round(game)

            return response  # Returns JSON containing trick details

        except Exception as e:
            return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

    return JsonResponse({'error': 'Invalid request method'}, status=400)

@csrf_exempt
def determine_bot_trump_decision(request):
    if request.method == "POST":
        try:
            # Fetch the latest game
            game = Game.objects.latest('id')

            # Fetch the player
            bot_name = request.POST.get("player")

            # Fetch the trump round
            trump_round = request.POST.get("trump_round")

            try:
                bot = Player.objects.get(name=bot_name)
            except Player.DoesNotExist:
                return JsonResponse({"error": f"Player '{bot_name}' does not exist."}, status=400)
            
            # Fetch the latest hand
            latest_hand = Hand.objects.filter(game=game).order_by('-id').first()

            bot_hand_played_cards = PlayedCard.objects.filter(player=bot, hand=latest_hand)
            bot_hand = [played_card.card for played_card in bot_hand_played_cards]

            # Fetch the up card
            up_card_string = request.POST.get("up_card")
            up_card_rank, up_card_suit = up_card_string.split(" of ")
            up_card = Card.objects.get(rank=up_card_rank, suit=up_card_suit)

            # Fetch the player order
            player_order_data = json.loads(request.POST.get("player_order"))
            player_order = [Player.objects.get(name=player['name']) for player in player_order_data]

            # Determine the trump decision
            trump_decision, going_alone = bot.determine_trump(bot_hand, game.dealer, up_card, player_order, trump_round)

            return JsonResponse({"decision": trump_decision, "going_alone": going_alone})

        except Exception as e:
            return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)
        
def sort_hand(hand, trump_suit=None):
    """
    Sorts a list of Cards based on their suits and ranks
    """
    def euchre_sort_key(card):
        suit_order = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3}

        if trump_suit:
            if card.is_right_bower(trump_suit):
                suit_group = 0
            elif card.is_left_bower(trump_suit):
                suit_group = 1
            elif card.suit == trump_suit:
                suit_group = 2
            else:
                suit_group = suit_order.get(card.suit, 4) + 3
        else:
            suit_group = suit_order.get(card.suit, 4)
        
        rank_values = {
            'A': 6,
            'K': 5,
            'Q': 4,
            'J': 3,
            '10': 2,
            '9': 1
        }

        return (suit_group, -rank_values.get(card.rank, 0))
            
    print(f"Sorting hand")
    return sorted(hand, key=euchre_sort_key)
    
@csrf_exempt
def init_trick(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request method."}, status=400)
    try:
        game = Game.objects.latest('id')
        going_alone = request.POST.get("going_alone") == "true"
        trump_caller_name = request.POST.get("trump_caller")
        trump_caller = Player.objects.get(name=trump_caller_name)

        players = list(Player.objects.all())
        dealer_index = players.index(game.dealer)
        leader = players[(dealer_index + 1) % len(players)]

        play_order = players[:]
        if going_alone:
            partner = next(p for p in play_order if p.name == trump_caller.partner)
            play_order.remove(partner)

        # Order array starting from leader
        li = play_order.index(leader) if leader in play_order else 0
        ordered = play_order[li:] + play_order[:li]

        return JsonResponse({"leader": leader.name, "play_order": [p.name for p in ordered]})
    except Exception as e:
        return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

@csrf_exempt
def play_player_card(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request method."}, status=400)
    try:
        game = Game.objects.latest('id')
        # Use the dealt hand for this round (most recent hand created during deal_hand/deal_next_hand)
        dealt_hand = Hand.objects.filter(game=game).order_by('-id').first()
        player = Player.objects.get(is_human=True)

        selected_card_str = request.POST.get("selected_card")
        if not selected_card_str or " of " not in selected_card_str:
            return JsonResponse({"error": "Invalid card format."}, status=400)
        r, s = selected_card_str.split(" of ")
        card = Card.objects.get(rank=r, suit=s)

        # Validate the player has this card in current hand
        player_cards_qs = PlayedCard.objects.filter(player=player, hand=dealt_hand).values_list('card', flat=True)
        if card.id not in player_cards_qs:
            return JsonResponse({"error": "Card not in player hand."}, status=400)

        # Lead suit rule check: determine current lead suit from current_cards
        current_cards_json = request.POST.get("current_cards")
        current_cards = json.loads(current_cards_json) if current_cards_json else []
        if current_cards:
            lr, ls = current_cards[0].split(" of ")
            lead_card = Card.objects.get(rank=lr, suit=ls)
            lead_suit = lead_card.next_suit() if lead_card.is_left_bower(game.trump_suit) else lead_card.suit

            # Enforce follow suit if possible
            hand_cards = Card.objects.filter(id__in=player_cards_qs)
            has_lead = any((c.next_suit() if c.is_left_bower(game.trump_suit) else c.suit) == lead_suit for c in hand_cards)
            if has_lead:
                eff_sel = card.next_suit() if card.is_left_bower(game.trump_suit) else card.suit
                if eff_sel != lead_suit:
                    return JsonResponse({"error": "Must follow suit."}, status=400)

        # Remove the card from the player's dealt hand (represents playing it)
        PlayedCard.objects.filter(player=player, hand=dealt_hand, card=card).delete()

        return JsonResponse({"played_card": f"{card.rank} of {card.suit}"})
    except Exception as e:
        return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

@csrf_exempt
def play_bot_card(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request method."}, status=400)
    try:
        game = Game.objects.latest('id')
        dealt_hand = Hand.objects.filter(game=game).order_by('-id').first()
        bot_name = request.POST.get("bot")
        bot = Player.objects.get(name=bot_name)

        # Current trick context
        current_cards = json.loads(request.POST.get("current_cards") or "[]")
        current_players = json.loads(request.POST.get("current_players") or "[]")  # names, in order

        # Map names to Player instances
        name_to_player = {p.name: p for p in Player.objects.all()}
        ordered_players = [name_to_player[name] for name in current_players if name in name_to_player]

        # Build played_cards with proper player mapping for the current trick
        played_cards = []
        for i, s in enumerate(current_cards):
            r, su = s.split(" of ")
            c = Card.objects.get(rank=r, suit=su)
            p = ordered_players[i] if i < len(ordered_players) else bot
            played_cards.append(PlayedCard(player=p, hand=dealt_hand, card=c, order=i+1))

        # Bot hand = remaining cards in dealt hand
        bot_cards_ids = PlayedCard.objects.filter(player=bot, hand=dealt_hand).values_list('card', flat=True)
        bot_hand = list(Card.objects.filter(id__in=bot_cards_ids))
        if not bot_hand:
            return JsonResponse({"error": "Bot hand is empty."}, status=500)

        # Previous tricks from frontend
        prev_tricks_json = json.loads(request.POST.get("previous_tricks") or "[]")
        # Convert to {trick_number: [PlayedCard,...]} with correct player assignment
        previous_tricks = {}
        for t in prev_tricks_json:
            tnum = t.get("trick_number")
            t_players = t.get("players", [])
            t_cards = t.get("cards", [])
            trick_pcs = []
            for i, s in enumerate(t_cards):
                r, su = s.split(" of ")
                c = Card.objects.get(rank=r, suit=su)
                p = name_to_player.get(t_players[i], bot)
                trick_pcs.append(PlayedCard(player=p, hand=dealt_hand, card=c, order=i+1))
            previous_tricks[tnum or len(previous_tricks)+1] = trick_pcs

        # Trump caller and going alone context
        trump_caller_name = request.POST.get("trump_caller")
        going_alone = request.POST.get("going_alone") == "true"
        trump_caller = name_to_player.get(trump_caller_name, None)

        # Compute tricks_won per team from previous_tricks
        team1_names = {"Player", "Team Mate"}
        team2_names = {"Opponent1", "Opponent2"}
        team1_tricks = sum(1 for t in prev_tricks_json if t.get("winner") in team1_names)
        team2_tricks = sum(1 for t in prev_tricks_json if t.get("winner") in team2_names)
        tricks_won = team1_tricks if bot.team == 1 else team2_tricks

        # Use the BotLogic implementation on Player (Player inherits BotLogic)
        chosen = bot.determine_best_card(
            bot_hand,
            game.trump_suit,
            played_cards,
            previous_tricks,
            trump_caller,
            going_alone,
            tricks_won
        )

        # Remove chosen card from bot’s dealt hand to reflect play
        PlayedCard.objects.filter(player=bot, hand=dealt_hand, card=chosen).delete()

        return JsonResponse({"played_card": f"{chosen.rank} of {chosen.suit}"})
    except Exception as e:
        return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)
    
@csrf_exempt
def resolve_trick(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request method."}, status=400)
    try:
        print("Resolving trick...")
        game = Game.objects.latest('id')
        cards = json.loads(request.POST.get("cards") or "[]")
        trick_players = json.loads(request.POST.get("players") or "[]")  # names in actual play order
        pcs = []
        latest_hand = Hand.objects.filter(game=game).order_by('-id').first()

        # Map names to Player instances in the exact order provided by frontend
        name_to_player = {p.name: p for p in Player.objects.all()}
        ordered_players = [name_to_player[name] for name in trick_players if name in name_to_player]

        # Reconstruct PlayedCard-like list with correct player for each card
        for i, s in enumerate(cards):
            r, su = s.split(" of ")
            c = Card.objects.get(rank=r, suit=su)
            p = ordered_players[i] if i < len(ordered_players) else None
            pcs.append(PlayedCard(player=p, hand=latest_hand, card=c, order=i+1))

        from .models import evaluate_trick_winner
        winner = evaluate_trick_winner(game.trump_suit, pcs)
        if not winner:
            return JsonResponse({"error": "Unable to evaluate trick winner."}, status=500)
        winner_name = winner.name

        # Compute next play order starting from winner; honor going alone
        # Base it on the current trick_players list (already reflects lone player removal)
        if winner_name in trick_players:
            wi = trick_players.index(winner_name)
        else:
            wi = 0
        next_order = trick_players[wi:] + trick_players[:wi]

        return JsonResponse({
            "winner": winner_name,
            "next_play_order": next_order
        })
    except Exception as e:
        return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)

@csrf_exempt
def finalize_round(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request method."}, status=400)
    try:
        game = Game.objects.latest('id')
        tricks = json.loads(request.POST.get("tricks") or "[]")
        trump_caller_name = request.POST.get("trump_caller")
        going_alone = request.POST.get("going_alone") == "true"
        trump_caller = Player.objects.get(name=trump_caller_name)

        team1_tricks = sum(1 for t in tricks if t.get("winner") in ["Player", "Team Mate"])
        team2_tricks = sum(1 for t in tricks if t.get("winner") in ["Opponent1", "Opponent2"])

        from .models import update_game_results
        update_game_results(game, team1_tricks, team2_tricks, trump_caller, going_alone)

        winning_team = "Team 1" if game.team1_points >= 10 else "Team 2" if game.team2_points >= 10 else None
        return JsonResponse({
            "team1_points": game.team1_points,
            "team2_points": game.team2_points,
            "winning_team": winning_team
        })
    except Exception as e:
        return JsonResponse({"error": f"Internal Server Error: {str(e)}"}, status=500)
